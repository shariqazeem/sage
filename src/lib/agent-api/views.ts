import "server-only";

import type { DecisionBrief } from "@/lib/deputy/brain-core";

/** reviewing = no decision yet · verified = decided pay (settling/awaiting) · held · paid */
export type SubmissionState = "reviewing" | "verified" | "held" | "paid" | "rejected";

/**
 * The one truthful reduction of a tester submission's public status, shared by the founder
 * console, the ClawUp agent API, and the Telegram announces so they never disagree. Derived
 * only from the durable submission row + the stored decision — never a client flag.
 */
export function submissionState(
  sub: { status: string; payoutTx: string | null },
  brief: DecisionBrief | null,
): SubmissionState {
  if (sub.status === "paid" && sub.payoutTx) return "paid";
  // A founder's refusal outranks the judge's brief: a worker whose page was refused must read
  // "rejected" and the reason, not a stale "verified" from the decision that preceded the refusal.
  // Measured 2026-09-11 on the public view of a gig where two refused pages showed as verified/held.
  if (sub.status === "rejected" || sub.status === "blocked") return "rejected";
  if (!brief) return "reviewing";
  return brief.recommendation === "pay" ? "verified" : "held";
}
