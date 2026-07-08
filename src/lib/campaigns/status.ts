/**
 * The submission lifecycle, as a pure state machine so the rules are one place
 * and unit-testable without the DB. A submission is created `pending`; the poster
 * approves or rejects it; approval settles on-chain and, when the spend settles,
 * moves it to `paid`. `rejected` and `paid` are terminal.
 */
export type SubmissionStatus = "pending" | "approved" | "rejected" | "paid";

const ALLOWED: Record<SubmissionStatus, readonly SubmissionStatus[]> = {
  pending: ["approved", "rejected"],
  approved: ["paid", "rejected"], // reject remains possible if a settle keeps failing
  rejected: [],
  paid: [],
};

export function canTransition(
  from: SubmissionStatus,
  to: SubmissionStatus,
): boolean {
  return ALLOWED[from].includes(to);
}

/** A poster decision is only valid on a `pending` submission. */
export function canDecide(status: SubmissionStatus): boolean {
  return status === "pending";
}

/** Terminal states never change again. */
export function isTerminal(status: SubmissionStatus): boolean {
  return status === "rejected" || status === "paid";
}
