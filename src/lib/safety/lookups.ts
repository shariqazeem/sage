import "server-only";
import { registrable } from "./brands";

/**
 * THE TWO OPTIONAL LOOKUPS: Google Safe Browsing and a domain's age. Both are off unless configured, both
 * are bounded, and neither can fail a screen: an answer that does not arrive is "unavailable", never "safe".
 * The suite hands in its own `fetch`; with none handed in, a test makes no call at all.
 */

const inTest = (): boolean => !!process.env.VITEST || process.env.NODE_ENV === "test";
const TIMEOUT_MS = 5_000;

async function getJson(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Google Safe Browsing (Lookup API v4), only when `SAFE_BROWSING_API_KEY` is set. Sends the product's
 * address and nothing about the builder. Returns the threat types Google lists for it ([] for none), null
 * when it could not be asked, and undefined when it is switched off.
 */
export async function safeBrowsingThreats(urls: readonly string[], deps: { fetch?: typeof fetch } = {}): Promise<string[] | null | undefined> {
  const key = process.env.SAFE_BROWSING_API_KEY?.trim();
  if (!key) return undefined;
  if (!deps.fetch && inTest()) return undefined;
  const entries = [...new Set(urls)].filter((u) => /^https?:\/\//i.test(u)).slice(0, 8).map((url) => ({ url }));
  if (entries.length === 0) return [];
  const body = {
    client: { clientId: "product-screen", clientVersion: "1" },
    threatInfo: {
      threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
      platformTypes: ["ANY_PLATFORM"],
      threatEntryTypes: ["URL"],
      threatEntries: entries,
    },
  };
  // the key travels in a header, never in the address, so it cannot land in a log line
  const json = await getJson(deps.fetch ?? fetch, "https://safebrowsing.googleapis.com/v4/threatMatches:find", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
  if (json === null || typeof json !== "object") return null;
  const matches = (json as { matches?: { threatType?: unknown }[] }).matches;
  if (!Array.isArray(matches)) return [];
  return [...new Set(matches.map((m) => (typeof m.threatType === "string" ? m.threatType : "")).filter(Boolean))];
}

/**
 * Days since a domain was registered, from RDAP (free, no key), only when `PRODUCT_SCREEN_RDAP=1`. Many
 * endings publish no registration date; then the answer is null and the screen simply has no age to weigh.
 * Undefined when switched off.
 */
export async function domainAgeDays(host: string, deps: { fetch?: typeof fetch; nowMs?: number } = {}): Promise<number | null | undefined> {
  if ((process.env.PRODUCT_SCREEN_RDAP ?? "").trim() !== "1") return undefined;
  if (!deps.fetch && inTest()) return undefined;
  const { domain, suffix } = registrable(host);
  // a site under a shared host has no registration of its own
  if (!domain || !suffix || suffix.includes(".") && !/^[a-z]{2,3}\.[a-z]{2}$/.test(suffix)) return null;
  const json = await getJson(deps.fetch ?? fetch, `https://rdap.org/domain/${encodeURIComponent(domain)}`, { headers: { accept: "application/rdap+json" }, redirect: "follow" });
  if (json === null || typeof json !== "object") return null;
  const events = (json as { events?: { eventAction?: unknown; eventDate?: unknown }[] }).events;
  if (!Array.isArray(events)) return null;
  const registered = events.find((e) => e.eventAction === "registration" && typeof e.eventDate === "string");
  const at = registered ? Date.parse(registered.eventDate as string) : NaN;
  if (!Number.isFinite(at)) return null;
  const days = Math.floor(((deps.nowMs ?? Date.now()) - at) / 86_400_000);
  return days >= 0 ? days : null;
}
