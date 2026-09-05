import "server-only";
import { chainConfig } from "@/lib/deputy/networks";

import { listCampaigns, listSubmissions } from "@/lib/db/campaigns";
import { mainnetSettledToTesters, OPERATOR_WALLETS, decidedOnMainnet, settledLedger } from "./settled-ledger";
import { clusterKeyOf } from "./wallet-links";
import { payoutWait } from "./marketplace";

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
  /** share of judged mainnet submissions refused, 0-100 — the SAME number the explorer, landing and
   *  outcomes page show (settled-ledger.ts `decidedOnMainnet`). It used to be "anything not paid,
   *  held included" over this module's own population: 50% here against 43% one click away. */
  refusalSharePct: number;
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

  /**
   * MONEY COMES FROM THE SETTLED LEDGER, NOT A REWARD LOOKUP.
   *
   * Pricing paid submissions by the campaign's headline reward misreported every payout whose
   * settled amount differed ($4.74/$5.26 splits, the $0.10 payout) — one of the three
   * derivations behind three different public totals on 2026-09-01. The ledger prices each
   * settlement by what the vault actually released; the pace and judgement stats below stay on
   * submissions, which are the right source for THOSE.
   */
  const settled = mainnetSettledToTesters();
  /*
    PEOPLE, NOT WALLETS — the same collapse the marketplace and the outcomes page publish. This said
    31 while they said 24: the consolidation watch had linked the farmed gig's twelve wallets into one
    person, and this count had never heard of it. One derivation (`clusterKeyOf`), or two pages disagree
    about how many humans were paid on the founder's first screen.
  */
  const people = new Set(
    settledLedger()
      .filter((r) => r.mainnet && !r.operator && r.wallet)
      .map((r) => clusterKeyOf(r.wallet as string)),
  ).size;

  /*
    ONE WAIT, PUBLISHED ONCE. This page said "3 min 24 s" (submit → judged, every mainnet payout)
    while the marketplace said "2 min 55 s" (submit → money on chain, testers only) — the third pair
    of medians a judge could put side by side this week. The marketplace's derivation is the one the
    outcomes page and the package quote; quoting it here removes the arithmetic, not the honesty.
  */
  const wait = payoutWait();

  const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;

  return {
    testersPaid: people,
    usdcSettled: settled.usdcSettled,
    missionsPaid: settled.payouts,
    medianSecondsToPayout: wait.medianSeconds,
    paidLast7Days: paid.filter((s) => (s.decidedAt ?? 0) >= weekAgo).length,
    refusalSharePct: decidedOnMainnet().sharePct,
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
