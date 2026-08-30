import "server-only";
import { chainConfig } from "@/lib/deputy/networks";

import { listCampaigns, listSubmissions } from "@/lib/db/campaigns";

/**
 * PROOF THAT TESTERS EXIST — the one thing a founder needs before funding anything.
 *
 * A founder deciding whether to put $5 behind a plan is not worried about the $5. They are worried
 * that they will fund it and nobody will come. Nothing on the page they decide from answered that,
 * while the answer sat in the database: real people, paid, fast, this week.
 *
 * Everything here is derived from settled submissions — no estimates, no projections. Operator
 * wallets are excluded, because "we paid ourselves" is not evidence of supply, and testnet payouts
 * are excluded, because valueless tokens are not evidence of anything.
 */

/** Wallets the operator controls. Paying ourselves proves nothing, so it never counts as supply. */
const OPERATOR_WALLETS = new Set(
  [
    "0xdf70f6e8e656e5bb714ff0e8ca176d76f26890e3",
    "0x0def3d4124d0cd1708aeffe6c1bc8182342a44d6",
  ].map((w) => w.toLowerCase()),
);

/** GOAT Mainnet. Real USDC only. */
const MAINNET = 2345;

export interface TesterSupply {
  /** distinct external wallets that have been paid for verified work. */
  testersPaid: number;
  /** total USDC settled to them, in whole dollars (6dp base units divided out). */
  usdcSettled: number;
  /** completed, paid missions. */
  missionsPaid: number;
  /** median seconds from a tester submitting to USDC landing, or null with no data. */
  medianSecondsToPayout: number | null;
  /** how many were paid in the last 7 days — recency is what makes supply believable. */
  paidLast7Days: number;
  /** share of submissions that did NOT result in a payout, 0-100. Judgement, not a rubber stamp. */
  heldOrRejectedPct: number;
}

export function getTesterSupply(): TesterSupply {
  /**
   * EVERY MAINNET RAIL, NOT ONE CHAIN.
   *
   * This filtered on `chainId === 2345`, so the moment a second rail started paying people its
   * payouts vanished from every number here — testers paid, USDC settled, missions paid, time to
   * payout, all of it. Two real Starknet payouts existed and this said the rail did not.
   *
   * The registry already knows which chains are real money, and asking it means the next rail is
   * counted the day it settles rather than the day somebody remembers this line.
   */
  const mainnetCampaigns = new Set(
    listCampaigns()
      .filter((c) => chainConfig(c.chainId).isMainnet && !c.sandbox)
      .map((c) => c.id),
  );

  const all = [...mainnetCampaigns].flatMap((id) => listSubmissions(id));
  const paid = all.filter(
    (s) => s.status === "paid" && !OPERATOR_WALLETS.has(s.wallet.toLowerCase()),
  );

  const rewardById = new Map(
    listCampaigns().map((c) => [c.id, c.rewardAmount]),
  );
  const base = paid.reduce((sum, s) => sum + (rewardById.get(s.campaignId) ?? 0), 0);

  const durations = paid
    .filter((s) => s.decidedAt != null && s.createdAt != null)
    .map((s) => (s.decidedAt as number) - s.createdAt)
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);

  const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
  const decided = all.filter((s) => s.status !== "pending");

  return {
    testersPaid: new Set(paid.map((s) => s.wallet.toLowerCase())).size,
    usdcSettled: base / 1_000_000,
    missionsPaid: paid.length,
    medianSecondsToPayout: durations.length
      ? durations[Math.floor(durations.length / 2)]
      : null,
    paidLast7Days: paid.filter((s) => (s.decidedAt ?? 0) >= weekAgo).length,
    heldOrRejectedPct: decided.length
      ? Math.round(((decided.length - paid.length) / decided.length) * 100)
      : 0,
  };
}

/** "3 min 24 s" — the number a founder actually feels. Null input reads as unknown. */
export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds} seconds`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} minutes` : `${m} min ${s} s`;
}
