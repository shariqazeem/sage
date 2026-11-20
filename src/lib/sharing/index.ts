import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaignSharing } from "@/lib/db/schema";
import { nowSeconds } from "@/lib/db/keys";

/**
 * HOW A TEST IS SHARED (relaunch, 20 Nov 2026).
 *
 * The builder answers three questions on the offer card: does Sage's X account post the mission, does
 * it post the result, and are the findings public. These are the builder's words about their own
 * product, so the default is the quiet one: with no row, nothing is posted and the findings stay
 * private. Every reader goes through `sharingFor`; nothing reads the table directly.
 */
export type Sharing = {
  /** Sage's X account may post this test's mission while places are open. */
  postMission: boolean;
  /** Sage's X account may post what people found once the test ends. */
  postResult: boolean;
  /** anyone with the link may read the findings, not only the owner. */
  findingsPublic: boolean;
};

export const QUIET: Sharing = Object.freeze({ postMission: false, postResult: false, findingsPublic: false });

/** What the builder chose for this test; the quiet default when they never answered. */
export function sharingFor(campaignId: string): Sharing {
  const row = db.select().from(campaignSharing).where(eq(campaignSharing.campaignId, campaignId)).get();
  if (!row) return { ...QUIET };
  return { postMission: row.postMission, postResult: row.postResult, findingsPublic: row.findingsPublic };
}

/** What the builder actually answered, or null when they never have (an offer card then shows its defaults). */
export function sharingAnswered(campaignId: string): Sharing | null {
  const row = db.select().from(campaignSharing).where(eq(campaignSharing.campaignId, campaignId)).get();
  return row ? { postMission: row.postMission, postResult: row.postResult, findingsPublic: row.findingsPublic } : null;
}

/**
 * Record the builder's answers. A partial update keeps the answers it doesn't name, so turning one
 * switch never flips another. The caller has already checked that the session owns the campaign.
 */
export function setSharing(campaignId: string, patch: Partial<Sharing>, now = nowSeconds()): Sharing {
  const next: Sharing = { ...sharingFor(campaignId), ...pickBooleans(patch) };
  db.insert(campaignSharing)
    .values({ campaignId, ...next, updatedAt: now })
    .onConflictDoUpdate({ target: campaignSharing.campaignId, set: { ...next, updatedAt: now } })
    .run();
  return next;
}

/** Only real booleans pass: a missing or malformed field leaves the earlier answer standing. */
function pickBooleans(patch: Partial<Sharing>): Partial<Sharing> {
  const out: Partial<Sharing> = {};
  for (const key of ["postMission", "postResult", "findingsPublic"] as const) {
    if (typeof patch[key] === "boolean") out[key] = patch[key];
  }
  return out;
}
