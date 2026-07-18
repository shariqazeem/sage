/**
 * The truthful public status of RAIL 1 (the x402 payment for one verification).
 * Replaces the ambiguous "nullable payment tx" (where null could mean paid-and-
 * lost, not-configured, or not-attempted) with an explicit, persisted state. Pure
 * — no I/O, no server-only — so it unit-tests directly.
 */

export type X402Status =
  | "paid" // a real x402 payment settled — carries the tx hash
  | "live_fallback" // the rail is live but this payment failed; verification continued directly
  | "not_configured" // the x402 rail is not configured in this environment
  | "not_required" // no evidence operation required a payment
  | "legacy_unknown"; // a historical row we cannot classify honestly

export const X402_STATUSES: readonly X402Status[] = [
  "paid",
  "live_fallback",
  "not_configured",
  "not_required",
  "legacy_unknown",
];

/** Sanitized failure reason codes — NEVER a raw provider/viem error or stack. */
export type X402Reason =
  | "insufficient_payer_balance"
  | "payment_unavailable"
  | "facilitator_timeout"
  | "fee_payment_reverted"
  | "unknown_payment_failure";

export function isX402Status(s: string | null | undefined): s is X402Status {
  return !!s && (X402_STATUSES as readonly string[]).includes(s);
}

/**
 * Map a caught payment error MESSAGE to a sanitized reason code. Takes only the
 * (already one-lined) message string, never the error object, so no stack or
 * provider internals can leak. Pure.
 */
export function classifyX402Failure(message: string): X402Reason {
  const m = message.toLowerCase();
  if (m.includes("insufficient") || m.includes("balance")) {
    return "insufficient_payer_balance";
  }
  if (m.includes("timeout") || m.includes("timed out") || m.includes("etimedout")) {
    return "facilitator_timeout";
  }
  // the on-chain fee transfer itself reverted (e.g. a wrong-scale amount or a token issue) — distinct
  // from the facilitator being unreachable, so name it instead of falling through to "unknown".
  if (m.includes("revert")) {
    return "fee_payment_reverted";
  }
  if (
    m.includes("unavailable") ||
    m.includes("not found") ||
    m.includes("404") ||
    m.includes("500") ||
    m.includes("502") ||
    m.includes("503") ||
    m.includes("bad gateway") ||
    m.includes("server error") ||
    m.includes("econnrefused") ||
    m.includes("network") ||
    m.includes("fetch failed") ||
    m.includes("connect")
  ) {
    return "payment_unavailable";
  }
  return "unknown_payment_failure";
}

/**
 * Reconstruct the persisted x402 status of a decision row. New rows carry an
 * explicit `storedStatus`; historical rows (column NULL) are classified from the
 * only evidence we have — a real tx means "paid", otherwise "legacy_unknown"
 * (honest: we cannot tell why it was null before this model existed).
 */
export function deriveStoredX402Status(
  storedStatus: string | null | undefined,
  x402PaymentTx: string | null | undefined,
): X402Status {
  if (isX402Status(storedStatus)) return storedStatus;
  return x402PaymentTx ? "paid" : "legacy_unknown";
}

/** A short, honest human label for the UI. */
export function x402StatusLabel(status: X402Status): string {
  switch (status) {
    case "paid":
      return "Paid via x402";
    case "live_fallback":
      return "x402 unavailable — verified directly";
    case "not_configured":
      return "x402 rail not configured";
    case "not_required":
      return "No payment required";
    case "legacy_unknown":
      return "x402 status unknown (legacy)";
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return "x402 status unknown";
    }
  }
}

/** Only a real settled x402 payment counts as verification SPEND. */
export function x402CountsAsSpend(status: X402Status): boolean {
  return status === "paid";
}
