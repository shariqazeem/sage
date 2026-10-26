import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "./index";
import { submissions } from "./schema";

/**
 * WORK THAT IS PROMISED MONEY, NOT ONLY WORK THAT WAS PAID (26 Oct 2026).
 *
 * On open work the agent approves at once and the sweep settles 30 minutes later (finalization.ts).
 * Every cap counted `paid` and `settling` only, so during the window an approved submission held no
 * slot: a mission with one slot approved everyone who arrived inside the half hour, and a wallet
 * limited to one payout could be approved on two missions. At the window's end the vault refused the
 * extra slots for gas, and nothing at all stopped the second payout to the same wallet.
 *
 * These count `approved` too. They are HOLDS, not answers: an approval can still be revoked inside
 * its window, which frees what it held, so the only terminal count stays the paid one. Kept apart
 * from `campaigns.ts` for the reason `events-read.ts` gives: the pipeline's tests replace that module
 * with a fixed list of exports.
 */
const COMMITTED = ["paid", "settling", "approved"];

/** Submissions holding a slot on this mission (paid, settling, or approved and waiting out the window), other than `except`. */
export function countCommittedForMission(missionIdHash: string, except?: string): number {
  return db
    .select({ id: submissions.id })
    .from(submissions)
    .where(and(eq(submissions.missionIdHash, missionIdHash), inArray(submissions.status, COMMITTED), ...(except ? [ne(submissions.id, except)] : [])))
    .all().length;
}

/** Payouts promised to any of these wallets (one person) on this campaign, other than `except`. */
export function countCommittedByWalletsInCampaign(campaignId: string, wallets: readonly string[], except?: string): number {
  if (wallets.length === 0) return 0;
  const keys = new Set(wallets.map((w) => w.trim().toLowerCase().replace(/^0x0*/, "0x")));
  return db
    .select({ wallet: submissions.wallet })
    .from(submissions)
    .where(and(eq(submissions.campaignId, campaignId), inArray(submissions.status, COMMITTED), ...(except ? [ne(submissions.id, except)] : [])))
    .all()
    .filter((r) => keys.has(r.wallet.trim().toLowerCase().replace(/^0x0*/, "0x"))).length;
}
