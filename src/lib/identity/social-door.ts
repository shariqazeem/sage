import "server-only";
import type { Campaign } from "@/lib/db/schema";
import { isPublicWork } from "@/lib/campaigns/visibility";
import { listMissions } from "@/lib/db/campaigns";
import { identityFor } from "@/lib/db/identity";
import { hasPersonIdentity } from "@/lib/db/person-identities";
import { personWallets } from "./person";
import { worldIdConfig } from "./worldid";

/**
 * THE TESTER DOOR: `IDENTITY_DOOR=social` (20 Nov 2026, the founder's decision).
 *
 * The World ID door (`IDENTITY_DOOR=1`, door.ts) kept farms out and nearly everyone else too: two people
 * ever passed it. A $2 test has to be easy for a real person to join and not worth farming. So on
 * public work:
 * - a person takes a place by signing in with Google or X (or from their Telegram chat), or with a
 *   World ID proof they already hold;
 * - an account is one person. Every wallet that presented it shares one place per mission and one cap per
 *   test, through the same `personWallets` the World ID door counts with;
 * - a test that pays above `IDENTITY_SOCIAL_CEILING_USD` (default $5) still asks for World ID, because a
 *   Google account costs cents and a bigger reward is worth buying one for.
 *
 * `IDENTITY_DOOR=1` is untouched and keeps meaning World ID for everyone. Members-only work never
 * reaches this door: the team chose its people. The reward-tier rule (`IDENTITY_TIERS`) keeps running
 * beside this mode, as it does whenever the World ID door is not the one armed.
 */
export function socialDoorArmed(env: Record<string, string | undefined> = process.env): boolean {
  return env.IDENTITY_DOOR?.trim().toLowerCase() === "social";
}

export const DEFAULT_SOCIAL_CEILING_USD = 5;

/** The reward, in 6-decimal base units, above which a sign-in account is not enough. */
export function socialCeilingBase(env: Record<string, string | undefined> = process.env): number {
  const raw = env.IDENTITY_SOCIAL_CEILING_USD?.trim();
  const n = raw ? Number(raw) : NaN;
  const usd = Number.isFinite(n) && n >= 0 ? n : DEFAULT_SOCIAL_CEILING_USD;
  return Math.round(usd * 1_000_000);
}

const usd = (base: number): string => {
  const v = base / 1_000_000;
  return `$${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)}`;
};

/** The X option exists only once the founder has switched X login on in Privy (`NEXT_PUBLIC_LOGIN_X=1`). */
const xOffered = (env: Record<string, string | undefined> = process.env): boolean => env.NEXT_PUBLIC_LOGIN_X === "1";

/**
 * The most one place on this test pays. A test's missions carry their own rewards, so the campaign's
 * figure alone could sit under the ceiling while one mission pays over it.
 */
export function topRewardBase(campaign: Pick<Campaign, "id" | "rewardAmount">): number {
  const missions = listMissions(campaign.id).filter((m) => m.status === "active");
  return Math.max(campaign.rewardAmount ?? 0, ...missions.map((m) => m.rewardAmount ?? 0));
}

/** What this door asks of everyone on this test, before looking at who is asking. */
export type SocialDoorAsk = "none" | "social" | "worldid";

export function socialDoorAsk(campaign: Campaign): SocialDoorAsk {
  if (!socialDoorArmed() || !isPublicWork(campaign)) return "none";
  // Above the ceiling World ID decides, exactly as the World ID door does: only when it is configured.
  // Without it there is no check to send a person to, so the sign-in account stays the floor.
  if (worldIdConfig() && topRewardBase(campaign) > socialCeilingBase()) return "worldid";
  return "social";
}

/** Any wallet that is this person holds a server-verified Google, X or Telegram account. */
export function personHasSocialIdentity(wallet: string): boolean {
  return personWallets(wallet).some((w) => hasPersonIdentity(w));
}

/** What THIS wallet still has to do to take a place here, or null when the door is open to it. */
export function socialDoorNeed(campaign: Campaign, wallet: string): Exclude<SocialDoorAsk, "none"> | null {
  const ask = socialDoorAsk(campaign);
  if (ask === "none") return null;
  if (identityFor(wallet)) return null; // a World ID proof passes at every reward
  if (ask === "worldid") return "worldid";
  return personHasSocialIdentity(wallet) ? null : "social";
}

/** One sentence, one next step. */
export function socialSignInCopy(surface: "web" | "telegram" = "web"): string {
  const accounts = xOffered() ? "Google or X" : "Google";
  return surface === "telegram"
    ? `Open this test on the web and sign in with ${accounts} to take a place.`
    : `Sign in with ${accounts} to take a place in this test.`;
}

export function aboveCeilingCopy(surface: "web" | "telegram" = "web"): string {
  const line = `This test pays above ${usd(socialCeilingBase())}, so it asks for a one-time World ID check.`;
  return surface === "telegram" ? `${line} Open it on the web to do that once; after that, you can submit from chat.` : line;
}
