/**
 * The evidence fetcher (server-side). Given an already-SSRF-validated evidence
 * URL, it fetches with a hard timeout + byte cap and re-validates every redirect
 * hop against the SAME SSRF rules (validate.ts) — a public name that 302s inward
 * is the classic DNS-rebinding bypass, so each hop is checked, not just the first.
 * HTML is stripped to readable text. Unreachable / oversized / blocked is a
 * SIGNAL (ok:false + failReason), never a thrown exception — the brain judges
 * "evidence unavailable" rather than the pipeline crashing.
 *
 * No `server-only` marker: it holds no secret (just fetches URLs), so it stays
 * unit-testable with an injected fetch. It is imported only from server code.
 */
import { createHash } from "node:crypto";
import { validateEvidenceUrl } from "@/lib/campaigns/validate";

/**
 * Structured, NON-SENSITIVE provenance for a rendered-evidence attempt (W2). Carries lengths + digests +
 * outcome + URLs only — never raw attacker-controlled page text — so it is safe to journal. Recorded on
 * every triggered attempt (shadow OR enforce) for promotion analysis + payout auditability.
 */
export interface RenderProvenance {
  requestedUrl: string;
  finalUrl: string | null;
  mode: "shadow" | "enforce";
  triggerReason: "thin_text" | "no_js_notice";
  staticLen: number;
  staticDigest: string | null;
  renderedLen: number | null;
  renderedDigest: string | null;
  outcome: string; // RenderOutcome from evidence-render.ts
  rendererVersion: string;
  at: number;
}

export interface EvidenceResult {
  text: string;
  contentSha256: string | null;
  /** unix seconds. */
  fetchedAt: number;
  ok: boolean;
  failReason?: string;
  /** which fetch produced the text the JUDGE saw — "static" (plain HTTP) or "rendered" (headless browser,
   *  W2 enforce). In shadow mode this stays "static" (rendered text never reaches the judge). Absent on
   *  failures. */
  mode?: "static" | "rendered";
  /** rendered-capture provenance when a render was triggered (shadow or enforce); never raw page text. */
  render?: RenderProvenance;
}

const TIMEOUT_MS = 5000;
const MAX_BYTES = 250 * 1024; // 250KB cap
const MAX_REDIRECTS = 2;
const MAX_TEXT_CHARS = 40_000;
/** Below this, a static fetch's text is "thin" — the SPA-shell signature that warrants a rendered retry. */
const RENDER_THIN_CHARS = 200;

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** A static result worth re-fetching in a real browser: near-empty text, or an explicit no-JS notice. */
function isThinEvidence(text: string): boolean {
  return text.length < RENDER_THIN_CHARS || /\benable\s+JavaScript\b/i.test(text);
}

/**
 * The rendered-evidence rollout state (canonical resolver lives in evidence-render.ts; duplicated here as
 * a trivial env read so this module pulls NO browser deps). `off` (default / unknown) | `shadow` (legacy
 * `RENDERED_EVIDENCE=1` maps here — render + compare but the JUDGE still sees static) | `enforce`.
 */
function renderedEvidenceMode(): "off" | "shadow" | "enforce" {
  const raw = process.env.RENDERED_EVIDENCE_MODE?.trim().toLowerCase();
  if (raw === "shadow" || raw === "enforce" || raw === "off") return raw;
  if (process.env.RENDERED_EVIDENCE === "1") return "shadow";
  return "off";
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Strip HTML to readable text without a parser dep (defensive, not perfect). */
export function stripHtml(html: string): string {
  return collapse(
    html
      .replace(/<(script|style|noscript|template|svg|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, " ")
      // Surface link targets as text BEFORE stripping tags — otherwise every href is lost and a
      // criterion like "contains a functional link to a block explorer" can never be verified.
      .replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi, " $1 ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"),
  );
}

/** Read a response body but stop (and signal) the moment it exceeds `max` bytes. */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const body = res.body as ReadableStream<Uint8Array> | null;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        return null; // oversized
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out;
  }
  // No stream (e.g. a mocked Response): buffer, then enforce the cap.
  const ab = await res.arrayBuffer();
  const u8 = new Uint8Array(ab);
  return u8.byteLength > max ? null : u8;
}

/**
 * Fetch + normalize evidence. `fetchImpl` is injectable for tests; production
 * uses the global fetch. Every result — success or failure — is a value, so
 * callers never wrap this in try/catch for control flow.
 */
export async function fetchEvidence(
  rawUrl: string,
  opts?: { fetchImpl?: typeof fetch },
): Promise<EvidenceResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const fetchedAt = Math.floor(Date.now() / 1000);
  const fail = (failReason: string): EvidenceResult => ({
    text: "",
    contentSha256: null,
    fetchedAt,
    ok: false,
    failReason,
  });

  // Defense-in-depth: re-validate the entry URL even though the caller did.
  const entry = validateEvidenceUrl(rawUrl);
  if (!entry.ok) return fail(`blocked url: ${entry.error}`);
  let url = entry.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let redirects = 0;
    let res: Response;
    for (;;) {
      res = await fetchImpl(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5",
          "user-agent": "SageDeputy/1.0 (+evidence-verification)",
        },
      });
      const status = res.status;
      if (status >= 300 && status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return fail("redirect without location");
        if (redirects >= MAX_REDIRECTS) return fail("too many redirects");
        redirects += 1;
        let next: string;
        try {
          next = new URL(loc, url).toString();
        } catch {
          return fail("bad redirect target");
        }
        const hop = validateEvidenceUrl(next);
        if (!hop.ok) return fail(`blocked redirect: ${hop.error}`);
        url = hop.value;
        continue;
      }
      break;
    }

    if (res.status < 200 || res.status >= 300) return fail(`http ${res.status}`);

    // Fast reject on a declared oversized length before streaming.
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_BYTES) return fail("oversized");

    const buf = await readCapped(res, MAX_BYTES);
    if (buf === null) return fail("oversized");

    const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    const text = ctype.includes("html") ? stripHtml(raw) : collapse(raw);
    const staticText = text.slice(0, MAX_TEXT_CHARS);
    const contentSha256 = createHash("sha256").update(buf).digest("hex");
    const staticResult: EvidenceResult = { text: staticText, contentSha256, fetchedAt, ok: true, mode: "static" };

    // RENDERED CAPTURE (W2 — off | shadow | enforce). A client-rendered SPA returns a near-empty shell to
    // this plain fetch, so genuine work HOLDS for lack of evidence. When NOT off, and the static text is
    // thin, re-fetch in a guarded headless browser (adversarial — every request re-validated; see
    // evidence-render.ts). SHADOW: record the static-vs-rendered comparison but return STATIC (the judge's
    // input is byte-for-byte unchanged). ENFORCE: rendered text may reach the judge, only when richer.
    // Any failure keeps the static result. Dynamic import so this module pulls no browser deps unless a
    // render actually fires.
    const mode = renderedEvidenceMode();
    if (mode !== "off" && isThinEvidence(staticText)) {
      try {
        const { renderEvidence, RENDERER_VERSION } = await import("./evidence-render");
        const r = await renderEvidence(rawUrl);
        const render: RenderProvenance = {
          requestedUrl: rawUrl,
          finalUrl: r.finalUrl,
          mode,
          triggerReason: staticText.length < RENDER_THIN_CHARS ? "thin_text" : "no_js_notice",
          staticLen: staticText.length,
          staticDigest: contentSha256,
          renderedLen: r.text ? r.text.length : null,
          renderedDigest: r.text ? sha256(r.text) : null,
          outcome: r.outcome,
          rendererVersion: RENDERER_VERSION,
          at: fetchedAt,
        };
        // ENFORCE only: rendered text reaches the judge (when strictly richer). It is returned as `.text`,
        // so it receives the EXACT same untrusted-markers/caps/truncation as static evidence downstream.
        if (mode === "enforce" && r.text && r.text.length > staticText.length) {
          return { text: r.text.slice(0, MAX_TEXT_CHARS), contentSha256: sha256(r.text), fetchedAt, ok: true, mode: "rendered", render };
        }
        // SHADOW (or enforce-but-not-richer): the static evidence is what the judge sees; comparison logged.
        return { ...staticResult, render };
      } catch {
        /* keep the static result — the render is best-effort */
      }
    }

    return staticResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(
      /abort/i.test(msg) ? "timeout" : `fetch error: ${msg.slice(0, 80)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
