import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";
import { validateEvidenceUrl } from "@/lib/campaigns/validate";
import { isIpLiteral, isPublicIp } from "./ip-classify";

/**
 * ONE GUARDED READ OF A PAGE SOMEONE ELSE CHOSE.
 *
 * Every link a worker submits, and every page a founder hands over, is untrusted: it decides where the
 * server connects. The judge's evidence fetch was guarded. The deterministic checkers that decide whether
 * work is PAID were not. They fetched with `redirect: "follow"`, no timeout and no size cap, and with a
 * different browser identity than the judge. So:
 * - a worker's link could bounce the server to an internal address, such as the cloud metadata service;
 * - a slow or endless body could hang a payout decision;
 * - a page could show the checker one thing and the judge another (found by reading the money path,
 *   5 Nov 2026).
 *
 * This is the one guarded read they all share:
 *  - every hop (the link and each redirect) passes the string check (https, no credentials, no local or
 *    private literal) AND its DNS answers must ALL be public unicast, so a public name pointing at
 *    127.0.0.1 is refused;
 *  - redirects are followed by hand, at most MAX_REDIRECTS, each one re-checked;
 *  - a wall-clock timeout and a byte cap, the body streamed and cut off at the cap;
 *  - the SAME request identity the judge's evidence fetch uses, so a page cannot cloak by user agent.
 *
 * It returns a value for every outcome and never throws, so a checker can tell "this page failed the
 * work" from "the network failed us".
 */

export const GUARDED_HEADERS: Record<string, string> = {
  accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5",
  "accept-language": "en-US,en;q=0.9",
  // A realistic UA: the honest "SageDeputy/1.0" got evidence bot-walled (403 / challenge) on WAF-fronted
  // pages, which read as "no evidence" and held genuine work. The allowlistable marker is x-sage-agent.
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "x-sage-agent": "SageDeputy/1.0 (+evidence-verification)",
};

export type Lookup = (host: string) => Promise<{ address: string; family: number }[]>;

export interface GuardedPage {
  ok: boolean;
  /** the HTTP status of the final hop; 0 when no response arrived. */
  status: number;
  /** the URL the content came from, after redirects. */
  finalUrl: string;
  contentType: string;
  /** the decoded body (raw, NOT stripped), at most maxBytes. Empty on failure. */
  body: string;
  bytes: Uint8Array | null;
  /** why it failed, in engineering words, when !ok. */
  failReason?: string;
  /**
   * true when the failure is OURS or the network's (timeout, DNS, a dropped connection), not the page's,
   * so a checker should retry later rather than hold the work as failed.
   */
  transient?: boolean;
}

export interface GuardedFetchOptions {
  /** injected fetch (tests). When injected without a `lookup`, the DNS check is skipped: no real socket opens. */
  fetchImpl?: typeof fetch;
  /** injected DNS (tests simulating a rebinding answer). Production resolves with node:dns. */
  lookup?: Lookup;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /**
   * Keep the first maxBytes of an oversized body instead of failing. A checker reading a worker's long
   * article must not fail honest work for the page's weight; the cap still bounds memory and time.
   */
  truncate?: boolean;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;

export const realLookup: Lookup = async (host) => dnsLookup(host, { all: true, verbatim: true });

/** Every address the name resolves to must be public unicast; a mixed answer is refused. */
export async function publicHost(hostname: string, lookup: Lookup): Promise<{ ok: true } | { ok: false; reason: string; transient: boolean }> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIpLiteral(host)) return isPublicIp(host) ? { ok: true } : { ok: false, reason: "private address", transient: false };
  let recs: { address: string }[];
  try {
    recs = await lookup(host);
  } catch {
    return { ok: false, reason: "dns lookup failed", transient: true };
  }
  if (recs.length === 0) return { ok: false, reason: "no dns answer", transient: true };
  if (recs.some((r) => !isPublicIp(r.address))) return { ok: false, reason: "resolves to a private address", transient: false };
  return { ok: true };
}

async function readCapped(res: Response, max: number, truncate = false): Promise<Uint8Array | null> {
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
        await reader.cancel().catch(() => {});
        if (!truncate) return null;
        chunks.push(value.subarray(0, max - total));
        total = max;
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
  // Response-like test doubles carry only text()/json(); read them the same way, capped after the fact.
  const r = res as Partial<Response>;
  const text = typeof r.text === "function" ? await r.text() : typeof r.json === "function" ? JSON.stringify(await r.json()) : "";
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= max) return bytes;
  return truncate ? bytes.subarray(0, max) : null;
}

function headerOf(res: Response, name: string): string | null {
  const h = (res as Partial<Response>).headers;
  return h && typeof h.get === "function" ? h.get(name) : null;
}

export async function guardedFetchPage(rawUrl: string, opts: GuardedFetchOptions = {}): Promise<GuardedPage> {
  const f = opts.fetchImpl ?? fetch;
  // An injected fetch opens no real socket, so there is nothing for DNS to protect unless the test says so.
  const lookup: Lookup | null = opts.lookup ?? (opts.fetchImpl ? null : realLookup);
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const fail = (failReason: string, transient: boolean, status = 0, finalUrl = rawUrl): GuardedPage => ({
    ok: false, status, finalUrl, contentType: "", body: "", bytes: null, failReason, transient,
  });

  const entry = validateEvidenceUrl(rawUrl);
  if (!entry.ok) return fail(`blocked url: ${entry.error}`, false);
  let url = entry.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let res: Response;
    for (let hop = 0; ; hop++) {
      if (lookup) {
        const host = await publicHost(new URL(url).hostname, lookup);
        if (!host.ok) return fail(host.reason, host.transient, 0, url);
      }
      res = await f(url, { redirect: "manual", signal: controller.signal, headers: GUARDED_HEADERS });
      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        const loc = headerOf(res, "location");
        if (!loc) return fail("redirect without location", false, res.status, url);
        if (hop >= maxRedirects) return fail("too many redirects", false, res.status, url);
        let next: string;
        try {
          next = new URL(loc, url).toString();
        } catch {
          return fail("bad redirect target", false, res.status, url);
        }
        const checked = validateEvidenceUrl(next);
        if (!checked.ok) return fail(`blocked redirect: ${checked.error}`, false, res.status, url);
        url = checked.value;
        continue;
      }
      break;
    }
    const declared = Number(headerOf(res, "content-length") ?? "");
    if (!opts.truncate && Number.isFinite(declared) && declared > maxBytes) return fail("oversized", false, res.status, url);
    const bytes = await readCapped(res, maxBytes, opts.truncate === true);
    if (bytes === null) return fail("oversized", false, res.status, url);
    const body = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    // Redirect-following fetches report the final URL on the response; this one follows by hand, so the
    // final URL is the last hop it checked (a test double's own `url` wins when it sets one).
    const finalUrl = (res as Partial<Response>).url || url;
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      finalUrl,
      contentType: (headerOf(res, "content-type") ?? "").toLowerCase(),
      body,
      bytes,
      ...(res.status >= 200 && res.status < 300 ? {} : { failReason: `http ${res.status}`, transient: res.status === 429 || res.status >= 500 }),
    };
  } catch (e) {
    const aborted = e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message));
    return fail(aborted ? "timeout" : "network error", true, 0, url);
  } finally {
    clearTimeout(timer);
  }
}
