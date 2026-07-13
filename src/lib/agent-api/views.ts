import "server-only";

import type { DecisionBrief } from "@/lib/deputy/brain-core";

/** reviewing = no decision yet · verified = decided pay (settling/awaiting) · held · paid */
export type SubmissionState = "reviewing" | "verified" | "held" | "paid";

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
  if (!brief) return "reviewing";
  return brief.recommendation === "pay" ? "verified" : "held";
}
