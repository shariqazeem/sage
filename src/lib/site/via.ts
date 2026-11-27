/**
 * WHERE A BUILDER CAME FROM (28 Nov 2026). A link can carry a tag (`sagepays.xyz/?via=tiktok` under a video,
 * `?via=dm` in the founder's own outreach). The first tag a browser arrives with is kept for 30 days and
 * sent with the paste, so each test knows where its builder first came from.
 *
 * FIRST TOUCH: a later tag never replaces one that is still fresh. A tag is a short lower-case word and
 * anything else is ignored, so it cannot carry an address, a name or a script. Kept in this browser only
 * (`localStorage`), and every access is guarded: a private window or blocked storage simply has no tag.
 *
 * No imports, so the server reads the same rule the browser does (`cleanVia`).
 */
export const VIA_KEY = "sage_via";
export const VIA_TTL_MS = 30 * 24 * 3600 * 1000;
const TAG = /^[a-z0-9-]{1,32}$/;

/** The tag, lower-cased, when it is one; otherwise null. */
export function cleanVia(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const tag = raw.trim().toLowerCase();
  return TAG.test(tag) ? tag : null;
}

/** What is kept: the tag and when it was first seen. Null when it is missing, malformed or older than 30 days. */
export function readStored(raw: string | null, nowMs: number): string | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { tag?: unknown; at?: unknown };
    const tag = cleanVia(v?.tag);
    if (!tag || typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
    return nowMs - v.at <= VIA_TTL_MS && v.at <= nowMs + 60_000 ? tag : null;
  } catch {
    return null;
  }
}

/** What to write for this page load, or null to leave the storage alone (first touch wins while it is fresh). */
export function nextStored(search: string, stored: string | null, nowMs: number): string | null {
  const arriving = cleanVia(new URLSearchParams(search).get("via"));
  if (!arriving || readStored(stored, nowMs)) return null;
  return JSON.stringify({ tag: arriving, at: nowMs });
}

/** Called once per page load, in the browser: keep the tag this visit arrived with, if it is the first. */
export function rememberVia(): void {
  if (typeof window === "undefined") return;
  try {
    const next = nextStored(window.location.search, window.localStorage.getItem(VIA_KEY), Date.now());
    if (next) window.localStorage.setItem(VIA_KEY, next);
  } catch {
    /* storage is blocked: there is simply no tag */
  }
}

/** The tag to send with a paste, or undefined. */
export function storedVia(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return readStored(window.localStorage.getItem(VIA_KEY), Date.now()) ?? undefined;
  } catch {
    return undefined;
  }
}
