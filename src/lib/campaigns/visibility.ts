/**
 * WHAT "PUBLIC WORK" MEANS — one predicate, every caller.
 *
 * A campaign is public when a stranger can find it and be paid for it: it is listed (not a workspace's
 * own unlisted door) and it names no recipient list. That rule was written twice — once in the
 * marketplace filter, once in the submit route's two separate checks — and the identity door is a
 * third reader. Three copies of a two-clause rule is how one of them drifts, so it lives here.
 *
 * A third clause since 22 Nov 2026: a test whose PRODUCT is held for a safety review (`safety_hold`,
 * src/lib/safety/) is not public until a person at Sage clears it. It is not on Earn, the board, the
 * sitemap or the agent's mission list, and only the builder's invited people may answer.
 *
 * Nothing about money: the rule is about who can walk through the door, not what it pays.
 */
export function isPublicWork(campaign: {
  visibility?: string | null;
  allowlist?: string[] | null;
  safetyHold?: string | null;
}): boolean {
  if (isHeldForReview(campaign)) return false;
  const named = Array.isArray(campaign.allowlist) && campaign.allowlist.length > 0;
  return !named && campaign.visibility !== "unlisted";
}

/** The product is held for a safety review: nothing about this test is shown or sent to the public. */
export function isHeldForReview(campaign: { safetyHold?: string | null }): boolean {
  return typeof campaign.safetyHold === "string" && campaign.safetyHold.length > 0;
}
