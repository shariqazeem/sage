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

export interface EvidenceResult {
  text: string;
  contentSha256: string | null;
  /** unix seconds. */
  fetchedAt: number;
  ok: boolean;
  failReason?: string;
}

const TIMEOUT_MS = 5000;
const MAX_BYTES = 250 * 1024; // 250KB cap
const MAX_REDIRECTS = 2;
const MAX_TEXT_CHARS = 40_000;

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
    const contentSha256 = createHash("sha256").update(buf).digest("hex");
    return {
      text: text.slice(0, MAX_TEXT_CHARS),
      contentSha256,
      fetchedAt,
      ok: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(
      /abort/i.test(msg) ? "timeout" : `fetch error: ${msg.slice(0, 80)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
