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
// The HTML-to-text helpers live in read/html-text.ts, shared with the page reader, so neither module
// imports the other. Re-exported for existing callers.
import { collapse, stripHtml } from "@/lib/read/html-text";
import { PLATFORM_ONLY, readPage, readerKindFor } from "@/lib/read/page-reader";
export { stripHtml };
import { publicHost, realLookup, type Lookup } from "@/lib/net/guarded-fetch";

/**
 * Structured, NON-SENSITIVE provenance for a rendered-evidence attempt (W2). Carries lengths + digests +
 * outcome + URLs only — never raw attacker-controlled page text — so it is safe to journal. Recorded on
 * every triggered attempt (shadow OR enforce) for promotion analysis + payout auditability.
 */
export interface RenderProvenance {
  requestedUrl: string;
  finalUrl: string | null;
  mode: "shadow" | "enforce";
  /** Why the render fired. `loading_shell` and `shell_text_ratio` catch the MODERN app shell —
   *  full nav and footer around an empty body — which "thin text" alone never did. `product_page`
   *  is the caller's call, not a shell signal: the link is on the product under test, where the
   *  chrome-rich page that renders its numbers client-side lives (see `preferRender`). */
  triggerReason: "thin_text" | "no_js_notice" | "loading_shell" | "shell_text_ratio" | "product_page";
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
  mode?: "static" | "rendered" | "platform";
  /** rendered-capture provenance when a render was triggered (shadow or enforce); never raw page text. */
  render?: RenderProvenance;
}

const TIMEOUT_MS = 10_000;
/**
 * HOW MUCH OF A PAGE IS READ.
 *
 * Measured 5 Nov 2026 (Sage Bench · reader): a 250 KB cap refused most modern pages outright. A docs
 * page, a GitHub view, a YouTube page and a Medium article are each well past it, and "oversized" held a
 * worker's honest article for no reason but its weight. Now the head of the page is kept, up to
 * MAX_BYTES, and the judge reads the text of that, which it caps far lower anyway. Only a body DECLARED
 * beyond HARD_MAX_BYTES is refused unread, so a hostile link can't make the server stream a gigabyte.
 */
const MAX_BYTES = 4 * 1024 * 1024;
const HARD_MAX_BYTES = 64 * 1024 * 1024;
const MAX_REDIRECTS = 2;
const MAX_TEXT_CHARS = 40_000;
/** Below this, a static fetch's text is "thin" — the SPA-shell signature that warrants a rendered retry. */
const RENDER_THIN_CHARS = 200;
/**
 * A product-page render replaces a static capture that was NOT a shell, so it is a second opinion,
 * not a rescue: it wins only when it came back with at least this share of the static text. A
 * browser that met a consent wall, a bot check or a login gate returns a fraction of the page, and
 * that fraction must not replace real content. MEASURED on plausible.io's live demo: the static
 * capture was 2,155 characters of chrome and prose with none of the dashboard's numbers, and no
 * shell heuristic fired — the page is rich; it just renders the part that matters in JavaScript.
 */
const PRODUCT_PAGE_RENDER_FLOOR = 0.5;

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/**
 * A page whose visible text is still LOADING — the shell said so out loud.
 *
 * MEASURED on starkscan.co, whose contract pages render client-side: the fetched text contained
 * "Checking…" and nothing the criteria asked for. The judge reported exactly that ("the page shows
 * 'Checking...'") and held twice on genuinely correct evidence.
 */
const LOADING_SHELL = /\b(checking|loading|please wait)\s*[.…]/i;

/** Below this, visible text is a rounding error against the payload that produced it. */
const SHELL_TEXT_RATIO = 0.02;
/** Only apply the ratio to a payload big enough for it to mean anything. */
const SHELL_MIN_HTML = 50_000;

/**
 * A static result worth re-fetching in a real browser.
 *
 * The first version was `text.length < 200 || /enable JavaScript/`, which catches the CLASSIC empty
 * shell — `<div id="root"></div>` — and misses the modern one. Starkscan ships a full nav and
 * footer around an empty body: 2,753 characters of chrome, so it was never "thin", and the render
 * never fired for the exact page that needed it.
 *
 * MEASURED, to ground the thresholds rather than guess them:
 *
 *   starkscan contract (SPA)   html 115,501  text 1,635  ratio 1.42%  "Checking…"
 *   sagepays landing (SSR)     html  86,009  text 4,165  ratio 4.84%  —
 *   example.com (static)       html     559  text   142  ratio 25.4%  —
 *
 * Over-triggering costs a render; under-triggering holds work somebody actually did.
 */
export function isThinEvidence(text: string, rawHtml?: string): boolean {
  if (text.length < RENDER_THIN_CHARS) return true;
  if (/\benable\s+JavaScript\b/i.test(text)) return true;
  if (LOADING_SHELL.test(text)) return true;
  if (rawHtml && rawHtml.length >= SHELL_MIN_HTML && text.length / rawHtml.length < SHELL_TEXT_RATIO) {
    return true;
  }
  return false;
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
      if (total + value.byteLength > max) {
        // keep the head of the page: the words a person reads first are the ones that matter
        chunks.push(value.subarray(0, max - total));
        total = max;
        await reader.cancel().catch(() => {});
        break;
      }
      total += value.byteLength;
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
  // No stream (e.g. a mocked Response): buffer, then keep the head, as above.
  const ab = await res.arrayBuffer();
  const u8 = new Uint8Array(ab);
  return u8.byteLength > max ? u8.subarray(0, max) : u8;
}

/**
 * Fetch + normalize evidence. `fetchImpl` is injectable for tests; production
 * uses the global fetch. Every result — success or failure — is a value, so
 * callers never wrap this in try/catch for control flow.
 *
 * `preferRender`: the caller knows the link is a page on the product under test (the judge does —
 * `product-page.ts`), so when rendering is on, render it even though the static capture is not a
 * shell. The shell heuristics detect an EMPTY page; a product's dashboard is a full page whose
 * numbers arrive by JavaScript, and the judge holding on "the page shows no visitor numbers" was
 * judging the wrong capture.
 */
export async function fetchEvidence(
  rawUrl: string,
  opts?: { fetchImpl?: typeof fetch; preferRender?: boolean; lookup?: Lookup },
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

  // A PLATFORM LINK is read through its platform's public door: a Google Doc as its text, a sheet as CSV,
  // a PR with its description and merge state, a post with its words and time (read/page-reader.ts). The
  // plain page there is an editor shell, a player or a sign-in wall, so the judge read nothing and held
  // honest work. The work-proof checker reads the same way, so the judge and the checker see one text.
  // GitHub pull requests and issues too: the judge then reads the merge state and the change itself, the same
  // reading the checker used (one cached read serves both).
  const kind = readerKindFor(url);
  if (PLATFORM_ONLY.has(kind) || kind === "github_pull" || kind === "github_issue") {
    const r = await readPage(url, { fetchImpl: opts?.fetchImpl, lookup: opts?.lookup, render: null, maxChars: MAX_TEXT_CHARS });
    if (!r.read) return fail(r.reason ?? "platform read failed");
    const facts = r.facts ? Object.entries(r.facts).filter(([, v]) => v !== "").map(([k, v]) => `${k}: ${v}`).join(" · ") : "";
    const text = (facts ? `${r.text}\n\n[Platform facts read by Sage: ${facts}]` : r.text).slice(0, MAX_TEXT_CHARS);
    return { text, contentSha256: createHash("sha256").update(text).digest("hex"), fetchedAt, ok: true, mode: "platform" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let redirects = 0;
    let res: Response;
    for (;;) {
      // DNS, per hop: a public name that resolves to a private address (127.0.0.1.nip.io, a rebinding
      // answer) passes the string check above, so the answers themselves must all be public. An injected
      // fetch opens no socket, so the suites skip it unless they inject a lookup.
      const dns = opts?.lookup ?? (opts?.fetchImpl ? null : realLookup);
      if (dns) {
        const host = await publicHost(new URL(url).hostname, dns);
        if (!host.ok) return fail(host.transient ? `dns: ${host.reason}` : `blocked url: ${host.reason}`);
      }
      res = await fetchImpl(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5",
          "accept-language": "en-US,en;q=0.9",
          // A realistic UA — the honest "SageDeputy/1.0" got evidence fetches bot-walled (403 /
          // challenge page) on WAF-fronted products, which read as "no usable evidence" and held
          // genuine work. The allowlistable marker moves to x-sage-agent (same policy as inspection).
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          "x-sage-agent": "SageDeputy/1.0 (+evidence-verification)",
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

    // Fast reject only on an absurd declared length; anything else is read up to the cap and kept.
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > HARD_MAX_BYTES) return fail("oversized");

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
    const thin = isThinEvidence(staticText, raw);
    if (mode !== "off" && (thin || opts?.preferRender === true)) {
      try {
        const { renderEvidence, RENDERER_VERSION } = await import("./evidence-render");
        const r = await renderEvidence(rawUrl);
        const render: RenderProvenance = {
          requestedUrl: rawUrl,
          finalUrl: r.finalUrl,
          mode,
          triggerReason: !thin
            ? "product_page"
            : staticText.length < RENDER_THIN_CHARS
              ? "thin_text"
              : LOADING_SHELL.test(staticText)
                ? "loading_shell"
                : /\benable\s+JavaScript\b/i.test(staticText)
                  ? "no_js_notice"
                  : "shell_text_ratio",
          staticLen: staticText.length,
          staticDigest: contentSha256,
          renderedLen: r.text ? r.text.length : null,
          renderedDigest: r.text ? sha256(r.text) : null,
          outcome: r.outcome,
          rendererVersion: RENDERER_VERSION,
          at: fetchedAt,
        };
        /**
         * ENFORCE: the rendered text reaches the judge. It is returned as `.text`, so it receives
         * the EXACT same untrusted-markers/caps/truncation as static evidence downstream.
         *
         * The condition used to be `rendered.length > static.length` — LENGTH as a proxy for
         * information. MEASURED on starkscan.co: the render returned 2,561 characters containing
         * the contract name, the tab strip and the transaction summary, and was thrown away for a
         * 2,753-character static shell padded with a cookie banner and nav. The whole chain worked
         * and the last line discarded the answer.
         *
         * A render only happens when the static text was already judged a shell. Once that is
         * decided, "longer" is not the question — the only thing worth checking is that the browser
         * actually came back with something, rather than an error page or a blank.
         */
        const renderedLen = r.text?.length ?? 0;
        const substantial = renderedLen >= RENDER_THIN_CHARS;
        // A shell's render wins on arriving; a product page's must clear PRODUCT_PAGE_RENDER_FLOOR.
        const richer = thin || renderedLen >= staticText.length * PRODUCT_PAGE_RENDER_FLOOR;
        if (mode === "enforce" && r.text && substantial && richer) {
          return { text: r.text.slice(0, MAX_TEXT_CHARS), contentSha256: sha256(r.text), fetchedAt, ok: true, mode: "rendered", render };
        }
        // SHADOW (or enforce-but-not-richer): the static evidence is what the judge sees; comparison logged.
        return { ...staticResult, render };
      } catch (err) {
        // Keep the static result — the render is best-effort — but never silently: a renderer that
        // cannot even load (a missing browser, a bad import) used to leave no trace at all, so a
        // product page judged on its shell looked exactly like a page nobody tried to render.
        const msg = err instanceof Error ? err.message.split("\n")[0].slice(0, 120) : String(err).slice(0, 120);
        console.warn(`[evidence-render] unavailable · ${msg}`);
        return {
          ...staticResult,
          render: {
            requestedUrl: rawUrl,
            finalUrl: null,
            mode,
            triggerReason: thin ? "thin_text" : "product_page",
            staticLen: staticText.length,
            staticDigest: contentSha256,
            renderedLen: null,
            renderedDigest: null,
            outcome: "error",
            rendererVersion: "unavailable",
            at: fetchedAt,
          },
        };
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
