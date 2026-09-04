/**
 * WHAT "PUBLIC WORK" MEANS — one predicate, every caller.
 *
 * A campaign is public when a stranger can find it and be paid for it: it is listed (not a workspace's
 * own unlisted door) and it names no recipient list. That rule was written twice — once in the
 * marketplace filter, once in the submit route's two separate checks — and the identity door is a
 * third reader. Three copies of a two-clause rule is how one of them drifts, so it lives here.
 *
 * Nothing about money: the rule is about who can walk through the door, not what it pays.
 */
export function isPublicWork(campaign: {
  visibility?: string | null;
  allowlist?: string[] | null;
}): boolean {
  const named = Array.isArray(campaign.allowlist) && campaign.allowlist.length > 0;
  return !named && campaign.visibility !== "unlisted";
}
