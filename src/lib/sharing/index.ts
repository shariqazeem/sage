import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, campaignSharing } from "@/lib/db/schema";
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

/**
 * What may be shared about this test: the builder's answers, or the quiet default when they never answered.
 *
 * A test whose product is held for a safety review (`campaigns.safety_hold`, src/lib/safety/) is quiet
 * whatever the builder chose: nothing is posted to X or the Telegram channel and its findings stay private
 * until a person at Sage clears it. The builder's own answers are kept and apply again from that moment.
 */
export function sharingFor(campaignId: string): Sharing {
  const held = db.select({ safetyHold: campaigns.safetyHold }).from(campaigns).where(eq(campaigns.id, campaignId)).get()?.safetyHold;
  if (held) return { ...QUIET };
  return chosenSharing(campaignId);
}

/** The builder's own answers, as stored. Only `setSharing` reads this; every other reader asks `sharingFor`. */
function chosenSharing(campaignId: string): Sharing {
  const row = db.select().from(campaignSharing).where(eq(campaignSharing.campaignId, campaignId)).get();
  if (!row) return { ...QUIET };
  return { postMission: row.postMission, postResult: row.postResult, findingsPublic: row.findingsPublic };
}

/**
 * Record the builder's answers. A partial update keeps the answers it doesn't name, so turning one
 * switch never flips another. The caller has already checked that the session owns the campaign.
 */
export function setSharing(campaignId: string, patch: Partial<Sharing>, now = nowSeconds()): Sharing {
  const next: Sharing = { ...chosenSharing(campaignId), ...pickBooleans(patch) };
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
