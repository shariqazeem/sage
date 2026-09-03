import type { BriefFraudSignal } from "@/lib/deputy/brain-core";

/**
 * WHEN WAS THE AUTHOR'S ACCOUNT CREATED, RELATIVE TO THE CAMPAIGN?
 *
 * On the first Starknet gig, five of the ten paid pages came from GitHub and dev.to accounts created
 * between one and fifteen minutes before their submission — three GitHub accounts within twenty
 * minutes of each other, with GitHub's own "-hub" / "-blip" / "-design" suggested-name suffixes. An
 * account that did not exist when the campaign started is a medium signal on its own (a newcomer
 * is allowed to be new); with a fresh wallet funded by another submitter it is the rotation pattern
 * and escalates (see sybil-escalation.ts). Any API failure yields no signal — never an accusation
 * from an outage.
 */
export const AUTHOR_AGE_GRACE_SECONDS = 24 * 3600;

export interface AuthorRef { host: "github" | "devto"; handle: string }

export function parseAuthor(url: string): AuthorRef | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = u.host.replace(/^www\./, "").toLowerCase();
  const seg = u.pathname.split("/").filter(Boolean);
  if ((host === "gist.github.com" || host === "github.com") && seg[0] && /^[a-z0-9][a-z0-9-]{0,38}$/i.test(seg[0])) return { host: "github", handle: seg[0] };
  if (host === "dev.to" && seg[0] && !seg[0].startsWith("t") && seg.length >= 2 && /^[a-z0-9_.-]+$/i.test(seg[0])) return { host: "devto", handle: seg[0] };
  return null;
}

export async function authorCreatedAt(ref: AuthorRef, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  try {
    if (ref.host === "github") {
      const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "sagepays-work-proof" };
      const token = process.env.GITHUB_TOKEN?.trim();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetchImpl(`https://api.github.com/users/${encodeURIComponent(ref.handle)}`, { headers, signal: AbortSignal.timeout(8_000) });
      if (res.status !== 200) return null;
      const body = (await res.json()) as { created_at?: unknown };
      const t = typeof body.created_at === "string" ? Date.parse(body.created_at) : NaN;
      return Number.isFinite(t) ? Math.floor(t / 1000) : null;
    }
    const res = await fetchImpl(`https://dev.to/api/users/by_username?url=${encodeURIComponent(ref.handle)}`, { headers: { "User-Agent": "sagepays-work-proof" }, signal: AbortSignal.timeout(8_000) });
    if (res.status !== 200) return null;
    const body = (await res.json()) as { joined_at?: unknown };
    // dev.to returns a display date ("Sep  3, 2026"); Date.parse reads it once the double space is gone.
    const t = typeof body.joined_at === "string" ? Date.parse(body.joined_at.replace(/\s+/g, " ")) : NaN;
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  } catch {
    return null;
  }
}

export async function authorAgeSignal(
  evidenceUrl: string | null | undefined,
  campaignCreatedAt: number,
  fetchImpl: typeof fetch = fetch,
): Promise<BriefFraudSignal | null> {
  if (!evidenceUrl) return null;
  const ref = parseAuthor(evidenceUrl);
  if (!ref) return null;
  const created = await authorCreatedAt(ref, fetchImpl);
  if (created === null) return null;
  if (created < campaignCreatedAt - AUTHOR_AGE_GRACE_SECONDS) return null;
  const site = ref.host === "github" ? "GitHub" : "dev.to";
  const when = created >= campaignCreatedAt ? "after this campaign was created" : "within a day before this campaign was created";
  return {
    signal: "fresh author account",
    severity: "med",
    reason: `the ${site} account "${ref.handle}" that published this page was created ${when} (${new Date(created * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC) — a newcomer, or an account made for this reward`,
  };
}
