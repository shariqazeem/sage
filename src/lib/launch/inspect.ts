import "server-only";

/**
 * The bounded, safe product inspector. It crawls a small, prioritized set of
 * SAME-ORIGIN public pages and reduces each to a structured ProductObservation. It
 * reuses the FROZEN SSRF guard (`validateEvidenceUrl`) for the entry URL and every
 * redirect hop, ADDS a DNS-resolution private-IP check, and is bounded on pages,
 * depth, per-response bytes, total bytes, redirects, and wall-clock time. It fetches
 * ONLY top-level HTML (no JS execution, no subresources, no forms/mutations) — which
 * also means there is no browser-subresource SSRF vector to defend. Client-only
 * (JS-rendered) flows are reported as a limitation, never invented.
 */

import { lookup } from "node:dns/promises";
import { validateEvidenceUrl } from "@/lib/campaigns/validate";
import { extractObservation } from "./extract";
import type { ProductObservation } from "./schemas";

export interface InspectOptions {
  maxPages?: number;
  maxDepth?: number;
  perResponseBytes?: number;
  totalBytes?: number;
  timeBudgetMs?: number;
  maxRedirects?: number;
}

export interface InspectResult {
  startUrl: string;
  host: string;
  observations: ProductObservation[];
  /** honest limits of this inspection run. */
  limitations: string[];
  /** URLs blocked by the SSRF/scope guards (host, reason). */
  blocked: { url: string; reason: string }[];
}

const DEFAULTS: Required<InspectOptions> = {
  maxPages: 9,
  maxDepth: 2,
  perResponseBytes: 800 * 1024,
  totalBytes: 4 * 1024 * 1024,
  timeBudgetMs: 30_000,
  maxRedirects: 3,
};

/** Prioritize the pages that actually matter for testing; deprioritize footer/legal/social. */
const HIGH = /\/(sign-?up|signup|register|onboard|get-?started|pricing|plans|app|dashboard|docs?|documentation|product|features?|demo|how-it-works|start)(\/|$|\?)/i;
const LOW = /\/(privacy|terms|legal|cookie|gdpr|dpa|about|careers?|jobs|press|blog\/|contact|imprint|status|sitemap)(\/|$|\?)/i;
const SOCIAL = /(twitter|x|facebook|linkedin|github|youtube|instagram|discord|t\.me|medium|producthunt)\.(com|co|me|io)/i;
// Near-duplicate DETAIL pages (a proof/tx/id with a long hash) — one is representative;
// crawling many wastes the page budget on interchangeable content.
const DETAIL = /(0x)?[0-9a-f]{16,}|\/(proof|tx|receipt|order|invoice|share)\/[^/]+/i;

function priority(url: string): number {
  if (DETAIL.test(url)) return 3; // sample at most one, last
  if (HIGH.test(url)) return 0;
  if (LOW.test(url)) return 2;
  return 1;
}

/** A literal private/loopback/link-local/metadata IP (v4 + basic v6) — belt-and-braces. */
function isPrivateIp(addr: string, family: number): boolean {
  if (family === 4) {
    const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(addr);
    if (!m) return true;
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  const h = addr.toLowerCase();
  return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:");
}

async function resolvesPublic(host: string): Promise<boolean> {
  try {
    const rec = await lookup(host, { all: true });
    if (rec.length === 0) return false;
    return rec.every((r) => !isPrivateIp(r.address, r.family));
  } catch {
    return false;
  }
}

interface RawPage {
  ok: boolean;
  status: number;
  url: string;
  html: string;
  bytes: Uint8Array | null;
  reason?: string;
}

/** Bounded raw-HTML fetch with SSRF re-validation on every hop. Never throws. */
async function fetchPageRaw(rawUrl: string, o: Required<InspectOptions>): Promise<RawPage> {
  const entry = validateEvidenceUrl(rawUrl);
  if (!entry.ok) return { ok: false, status: 0, url: rawUrl, html: "", bytes: null, reason: entry.error };
  let url = entry.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(o.timeBudgetMs, 12_000));
  try {
    let redirects = 0;
    for (;;) {
      // DNS re-resolution guard: the host must resolve to public addresses only.
      const host = new URL(url).hostname;
      if (!(await resolvesPublic(host))) {
        return { ok: false, status: 0, url, html: "", bytes: null, reason: "host resolves to a private address" };
      }
      const res = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "text/html,application/xhtml+xml", "user-agent": "SageMissionBrain/1.0 (+read-only product inspection)" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc || redirects >= o.maxRedirects) return { ok: false, status: res.status, url, html: "", bytes: null, reason: "too many/blocked redirects" };
        redirects++;
        let next: string;
        try {
          next = new URL(loc, url).toString();
        } catch {
          return { ok: false, status: res.status, url, html: "", bytes: null, reason: "bad redirect target" };
        }
        const hop = validateEvidenceUrl(next);
        if (!hop.ok) return { ok: false, status: res.status, url, html: "", bytes: null, reason: `blocked redirect: ${hop.error}` };
        url = hop.value;
        continue;
      }
      const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!ctype.includes("html") && !ctype.includes("xml")) {
        return { ok: false, status: res.status, url, html: "", bytes: null, reason: `non-html content (${ctype || "unknown"})` };
      }
      const declared = Number(res.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > o.perResponseBytes) {
        return { ok: false, status: res.status, url, html: "", bytes: null, reason: "oversized" };
      }
      // stream + cap
      const reader = (res.body as ReadableStream<Uint8Array> | null)?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          total += value.byteLength;
          if (total > o.perResponseBytes) {
            await reader.cancel().catch(() => {});
            return { ok: false, status: res.status, url, html: "", bytes: null, reason: "oversized" };
          }
          chunks.push(value);
        }
      }
      const buf = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        buf.set(c, off);
        off += c.byteLength;
      }
      const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
      if (res.status < 200 || res.status >= 300) return { ok: false, status: res.status, url, html, bytes: buf, reason: `http ${res.status}` };
      return { ok: true, status: res.status, url, html, bytes: buf };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, url, html: "", bytes: null, reason: /abort/i.test(msg) ? "timeout" : `fetch error` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Inspect a product: crawl up to `maxPages` prioritized same-origin pages and return
 * their structured observations plus honest limitations. Never throws; a fully blocked
 * start URL returns an empty result with the reason in `limitations`.
 */
export async function inspectProduct(startUrl: string, opts: InspectOptions = {}, now = 0): Promise<InspectResult> {
  const o = { ...DEFAULTS, ...opts };
  const entry = validateEvidenceUrl(startUrl);
  const limitations: string[] = [
    "Inspection reads server-rendered HTML only — flows that render entirely client-side (JavaScript) may be under-observed.",
  ];
  const blocked: { url: string; reason: string }[] = [];
  if (!entry.ok) {
    return { startUrl, host: "", observations: [], limitations: [`Start URL rejected: ${entry.error}`], blocked };
  }
  const origin = new URL(entry.value);
  const host = origin.host.toLowerCase();

  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: entry.value, depth: 0 }];
  const observations: ProductObservation[] = [];
  let totalBytes = 0;
  const deadline = now > 0 ? 0 : Date.now() + o.timeBudgetMs; // now>0 only in deterministic tests

  while (queue.length > 0 && observations.length < o.maxPages) {
    if (deadline > 0 && Date.now() > deadline) {
      limitations.push("Inspection stopped at the time budget before covering every candidate page.");
      break;
    }
    // pop the highest-priority, shallowest URL
    queue.sort((a, b) => priority(a.url) - priority(b.url) || a.depth - b.depth);
    const { url, depth } = queue.shift()!;
    const key = url.replace(/#.*$/, "");
    if (visited.has(key)) continue;
    visited.add(key);

    const page = await fetchPageRaw(url, o);
    if (!page.ok) {
      blocked.push({ url, reason: page.reason ?? "unavailable" });
      continue;
    }
    totalBytes += page.bytes?.byteLength ?? 0;
    const obs = extractObservation({ url: page.url, status: page.status, html: page.html, bytes: page.bytes });
    obs.inspectedAt = now > 0 ? now : Math.floor(Date.now() / 1000);
    observations.push(obs);
    if (totalBytes > o.totalBytes) {
      limitations.push("Inspection stopped at the total byte budget.");
      break;
    }

    if (depth < o.maxDepth) {
      for (const raw of obs.links) {
        let abs: URL;
        try {
          abs = new URL(raw, page.url);
        } catch {
          continue;
        }
        if (abs.protocol !== "https:") continue;
        if (abs.host.toLowerCase() !== host) continue; // same-origin only
        if (SOCIAL.test(abs.toString())) continue;
        const k = abs.toString().replace(/#.*$/, "");
        if (visited.has(k) || queue.some((q) => q.url === k)) continue;
        // sample at most ONE near-duplicate detail page (proof/tx/id-with-hash).
        if (DETAIL.test(k)) {
          const haveDetail = observations.some((x) => DETAIL.test(x.url)) || queue.some((q) => DETAIL.test(q.url));
          if (haveDetail) continue;
        }
        queue.push({ url: k, depth: depth + 1 });
      }
    }
  }

  if (observations.length === 0) limitations.push("No page could be inspected (all candidates were blocked or unavailable).");
  else if (queue.length > 0) limitations.push(`${queue.length} additional same-origin page(s) were discovered but not inspected within the page budget.`);
  return { startUrl: entry.value, host, observations, limitations, blocked };
}
