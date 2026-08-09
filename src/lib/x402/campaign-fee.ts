import { MIN_USDC } from "./facilitator";

/**
 * THE CAMPAIGN LAUNCH FEE — what Sage actually charges for.
 *
 * Until now the product had no take-rate at all. `allocateBudget` holds
 * `Σ(rewardBase × maxCompletions) === totalBudgetBase` exactly, so every cent a founder funded went
 * to testers, and the only x402 payment in the system was the operator fee, which Sage paid to
 * ITSELF out of its own wallet. That demonstrated the rail and earned nothing.
 *
 * This is the fee the founder pays to launch a funded campaign, collected over x402 at launch. It is
 * deliberately not a separate invented line item: the x402 payment IS the price, one charge, one
 * concept. Because it goes over the rail it also lands in the GOAT Flow merchant dashboard as a real
 * order, so revenue is tracked without us building a ledger for it.
 *
 * The tester pool is untouched. A founder funding a $10 campaign still puts $10 in front of testers
 * and pays the fee alongside it, which keeps the frozen budget invariant intact and keeps the
 * promise on the comparison page honest: all of your budget reaches the people doing the work.
 */

/** 10% of the funded budget. One constant — change it here and nowhere else. */
export const CAMPAIGN_FEE_PCT = 10;

/**
 * The fee for a budget, in USDC base units (6dp).
 *
 * INTEGER MATH ONLY — bigint throughout, never a float, which is the same reason the budget compiler
 * works in base units. Truncating division rounds DOWN, so a rounding error can only ever favour the
 * founder, which is the direction an unattended money path should fail in.
 *
 * (BigInt() calls rather than `10n` literals: this repo targets ES2017, matching `budget.ts`.)
 *
 * Floored at the facilitator's own minimum. GOAT will not accept a payment under 0.1 USDC, so a
 * budget below $1 would otherwise compute a fee that cannot physically be charged, and the launch
 * would fail at the payment step for a reason the founder could do nothing about.
 */
export function campaignFeeBase(budgetBase: bigint): bigint {
  if (budgetBase <= BigInt(0)) return BigInt(0);
  const minBase = BigInt(Math.round(MIN_USDC * 1_000_000));
  const pct = (budgetBase * BigInt(CAMPAIGN_FEE_PCT)) / BigInt(100);
  return pct < minBase ? minBase : pct;
}

/**
 * Is this founder paying themselves?
 *
 * The operator funds seed campaigns from their own wallets, and a fee they pay to their own merchant
 * address is not revenue — it is money moving between two pockets they already own. Charged all the
 * same (they asked for no exemptions, and it keeps the accounting uniform), but RECORDED as
 * self-funded so any number reported to GOAT, a grant, or an investor can exclude it.
 *
 * Case-insensitive because addresses arrive checksummed from some paths and lowercased from others,
 * and a comparison that silently fails would misclassify real revenue as self-funded.
 */
export function isSelfFunded(payer: string | null | undefined, operatorAddresses: readonly string[]): boolean {
  if (!payer) return false;
  const p = payer.trim().toLowerCase();
  return operatorAddresses.some((a) => a.trim().toLowerCase() === p);
}
