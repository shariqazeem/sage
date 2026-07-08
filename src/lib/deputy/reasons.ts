/**
 * SpendRejected.failedCheckIndex → human reason. Mirrors the contract's check
 * order exactly (1=state, 2=caller, 3=vendor, 4=amount, 5=budget, 6=velocity).
 * Pure and shared by every path that surfaces a soft-reject (payout, settle).
 */
export const CHECK_REASONS: Record<number, string> = {
  1: "the vault is paused, expired, or revoked",
  2: "the caller is not the authorized operator",
  3: "the recipient is not on the approved allowlist",
  4: "the amount exceeds the per-payout cap",
  5: "the payout would exceed the remaining budget",
  6: "the payout would exceed the 24h velocity cap",
};

/**
 * Short display names for each check, in contract order. Pure display copy that
 * lives next to CHECK_REASONS so any surface (the landing's check rail, the Gate)
 * names the checks the same way the contract enforces them. Not business logic —
 * the enforcement order lives in the vault; this only labels it.
 */
export const CHECK_NAMES: Record<number, string> = {
  1: "Vault state",
  2: "Authorized caller",
  3: "Approved recipient",
  4: "Per-payout cap",
  5: "Remaining budget",
  6: "24h velocity cap",
};

export function failedCheckReason(index: number | null | undefined): string {
  return CHECK_REASONS[index ?? 0] ?? "a policy check failed";
}
