/**
 * WHO MAY TAKE THE BETTER-PAID WORK.
 *
 * The first Starknet gig was taken 10 of 10 by one operator with twelve fresh wallets, because a
 * wallet that had never done anything stood exactly equal to one that had. Detectors caught it after
 * the money moved. This is the answer that makes the attack unprofitable BEFORE it: standing is
 * earned per wallet, so splitting one worker into twelve wallets divides their standing by twelve
 * instead of multiplying their slots.
 *
 * The door stays open. Tiering is by MONEY, not by entry: anyone may take low-paid work with no
 * history at all, and that is how standing is earned. Only the better-paid tiers ask for it. A
 * closed door would trade the farm for no supply, which is the same product with worse numbers.
 *
 * `personhood` is the seam for an external proof-of-personhood rail. When one is wired, a verified
 * person is established immediately and never has to grind — until then the record alone decides,
 * and nothing about the rest of this file changes when it arrives.
 *
 * Pure. No database, no network, no model.
 */

export type Tier = "flagged" | "newcomer" | "established";

export interface TierEvidence {
  /** payouts this wallet has actually received. */
  paidCompletions: number;
  /** how many DIFFERENT campaigns those came from. Twelve payouts from one board is one story. */
  distinctCampaigns: number;
  /** how many different founders paid them — the expensive signal to fake. */
  distinctPayers: number;
  /** wallets the consolidation watch has linked to this one. Any link is disqualifying. */
  linkedWallets: number;
  /** a verified person, when a personhood rail is wired. Null means "not asked". */
  personhood: "verified" | null;
}

export interface TierVerdict {
  tier: Tier;
  reason: string;
}

const RANK: Record<Tier, number> = { flagged: 0, newcomer: 1, established: 2 };

/** Standing, from what the ledger and the chain already know. */
export function tierOf(e: TierEvidence): TierVerdict {
  if (e.linkedWallets > 0) {
    return {
      tier: "flagged",
      reason: `this wallet is linked on-chain to ${e.linkedWallets} other${e.linkedWallets === 1 ? "" : "s"} that took paid work here`,
    };
  }
  if (e.personhood === "verified") {
    return { tier: "established", reason: "a verified person" };
  }
  if (e.paidCompletions >= 2 && e.distinctCampaigns >= 2) {
    const payers = e.distinctPayers > 1 ? `, for ${e.distinctPayers} different people` : "";
    return { tier: "established", reason: `${e.paidCompletions} verified payouts across ${e.distinctCampaigns} campaigns${payers}` };
  }
  if (e.paidCompletions > 0) {
    return { tier: "newcomer", reason: `${e.paidCompletions} verified payout${e.paidCompletions === 1 ? "" : "s"} so far — one more, on a different campaign, earns full standing` };
  }
  return { tier: "newcomer", reason: "no verified work here yet" };
}

/**
 * The standing a piece of work asks for, derived from what it pays. No campaign column and no
 * founder decision: the rule applies to every campaign that already exists, and a founder cannot
 * accidentally leave the expensive work open to anyone.
 */
export function requiredTier(rewardBase: number, thresholdBase = openTierCeilingBase()): Tier {
  return rewardBase > thresholdBase ? "established" : "newcomer";
}

/** Work at or below this pays anyone. Above it, standing is required. */
export function openTierCeilingBase(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.IDENTITY_OPEN_CEILING_USD);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 1e6) : 2_000_000;
}

export function meetsTier(actual: Tier, required: Tier): boolean {
  return RANK[actual] >= RANK[required];
}

/** What a person is told when their standing is not enough. Never a dead end. */
export function tierRefusal(verdict: TierVerdict, required: Tier, rewardBase: number, ceilingBase: number): string {
  const pay = `$${(rewardBase / 1e6).toFixed(2)}`;
  const ceiling = `$${(ceilingBase / 1e6).toFixed(2)}`;
  if (verdict.tier === "flagged") {
    return `This ${pay} mission is held for this wallet: ${verdict.reason}. Work already paid to a linked wallet counts as one person's, so the standing does not stack.`;
  }
  return `This ${pay} mission asks for verified standing first — ${verdict.reason}. Work paying ${ceiling} or less is open to anyone, and finishing one is how standing is earned. The board lists what is open now.`;
}
