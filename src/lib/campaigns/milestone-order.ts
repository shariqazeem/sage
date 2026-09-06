import type { Mission } from "@/lib/db/schema";

/**
 * MILESTONES RELEASE ONE BY ONE. A grant's plan promises exactly that ("J$1,600 in two equal parts —
 * half when…, half when…"), and the second milestone's own criteria refer to the first's page. So on
 * a GRANT, milestone i is open to a person only once milestone i−1 has PAID to that same person —
 * on both doors, the web board and the chat. Gigs and testing campaigns are unordered and untouched.
 * Pure: the caller says which missions this wallet has been paid for.
 */
export function priorMilestoneUnpaid(
  kind: "testing" | "gig" | "grant",
  ordered: readonly Mission[],
  mission: Mission,
  paidTo: (m: Mission) => boolean,
): Mission | null {
  if (kind !== "grant") return null;
  const i = ordered.findIndex((m) => m.missionKey === mission.missionKey);
  if (i <= 0) return null;
  const prior = ordered[i - 1]!;
  return paidTo(prior) ? null : prior;
}

export const milestoneLockedCopy = (prior: Mission) => `"${prior.title}" pays first — this milestone opens the moment it has.`;
