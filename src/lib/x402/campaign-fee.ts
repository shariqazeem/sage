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
/**
 * RETIRED AS A CHARGE, 2026-09-05. A 10% founder-side launch fee lived behind an env switch and
 * appeared in no document while every document described revenue as a flat fee per settlement.
 * Nothing charges it any more. `campaignFeeBase` survives for one reason: the FROZEN mandate
 * builder (`privy/mandate.ts`) sizes an optional allow-rule with it, and a frozen file is not
 * edited for a pricing change. The rule is never exercised.
 */
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

