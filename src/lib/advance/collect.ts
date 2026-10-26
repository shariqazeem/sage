import "server-only";

import { getAddress, type Address, type Hash } from "viem";
import { settledLedger } from "@/lib/campaigns/settled-ledger";
import { getCampaign, getMissionByHash, listPaidSubmissionsByWallet } from "@/lib/db/campaigns";
import { consideredSubmissions, listActiveAdvancesOn, recordMissedRepayment, recordRepayment } from "@/lib/db/advances";
import type { AdvanceRow } from "@/lib/db/schema";
import { splitForAdvance } from "./waterfall";
import { allowanceToPot, POT_CHAIN_ID, potBalances, potCollectUsdc, potConfig, potReceipt, usdcBalanceOf, type PotConfig } from "./pot";

/**
 * THE WATERFALL ON METIS (26 Oct 2026) — how an advance is repaid from witnessed inflow.
 *
 * On Starknet the waterfall split each payout's escrow into two legs before the worker collected. On Metis
 * the job vault pays the worker directly, and that payout path is frozen, so the split happens AFTER the
 * payout lands: for each verified Metis payout to a borrower since their advance, the pot collects its
 * share (`splitForAdvance`, at most N% of the payout, never more than is owed) with `transferFrom`, under
 * the allowance the borrower approved before the advance went out (disburse.ts refuses without it).
 *
 * The honest recourse, unchanged: repayment comes only from Sage-witnessed inflow. A payout whose share is
 * no longer there (the approval withdrawn, the money already moved) is recorded as missed, once, and the
 * balance it would have paid down stays owed: "at most N% of each payout", never a catch-up from the next.
 *
 * Runs in the sweep. Every collection is simulated before it is sent, so a share that cannot be collected
 * costs nothing; at most `limit` are sent per tick.
 */

export interface MetisPayout {
  submissionId: string;
  amountBase: bigint;
  at: number;
}

/** A borrower's verified Metis payouts after `sinceSec`, oldest first, with the amount the vault released. */
export function metisPayoutsSince(wallet: string, sinceSec: number): MetisPayout[] {
  const ledger = new Map(settledLedger().map((r) => [r.txHash, r.amountBase]));
  const out: MetisPayout[] = [];
  for (const s of listPaidSubmissionsByWallet(wallet)) {
    if (!s.payoutTx) continue;
    const at = s.decidedAt ?? s.createdAt;
    if (at < sinceSec) continue;
    const campaign = getCampaign(s.campaignId);
    if (!campaign || campaign.sandbox || campaign.chainId !== POT_CHAIN_ID) continue;
    const mission = s.missionIdHash ? getMissionByHash(campaign.id, s.missionIdHash) : null;
    const amountBase = ledger.get(s.payoutTx) ?? mission?.rewardAmount ?? campaign.rewardAmount;
    if (!(amountBase > 0)) continue;
    out.push({ submissionId: s.id, amountBase: BigInt(amountBase), at });
  }
  return out.sort((a, b) => a.at - b.at);
}

export interface CollectDeps {
  pot?: PotConfig | null;
  advances?: () => AdvanceRow[];
  payouts?: (wallet: string, sinceSec: number) => MetisPayout[];
  considered?: (advanceId: string) => Set<string>;
  potMetisWei?: (pot: PotConfig) => Promise<bigint>;
  allowance?: (pot: PotConfig, owner: Address) => Promise<bigint>;
  balanceOf?: (pot: PotConfig, owner: Address) => Promise<bigint>;
  collect?: (pot: PotConfig, from: Address, amountBase: bigint) => Promise<Hash>;
  receipt?: (hash: Hash) => Promise<"success" | "reverted">;
  repaid?: typeof recordRepayment;
  missed?: typeof recordMissedRepayment;
}

export interface CollectSummary {
  advances: number;
  collected: number;
  collectedBase: number;
  missed: number;
  paused: string | null;
}

/** The pot's own fee floor for collecting: a transferFrom on Metis costs well under this. */
const COLLECT_MIN_METIS_WEI = BigInt("1000000000000000"); // 0.001 METIS

export async function collectAdvanceRepayments(deps: CollectDeps = {}, limit = 5): Promise<CollectSummary> {
  const summary: CollectSummary = { advances: 0, collected: 0, collectedBase: 0, missed: 0, paused: null };
  const active = (deps.advances ?? (() => listActiveAdvancesOn(POT_CHAIN_ID)))();
  summary.advances = active.length;
  if (!active.length) return summary;

  const cfg = deps.pot !== undefined ? null : potConfig();
  const pot = deps.pot !== undefined ? deps.pot : cfg && cfg.ok ? cfg.pot : null;
  if (!pot) {
    summary.paused = "pot not configured";
    return summary;
  }
  const metis = await (deps.potMetisWei ?? (async (p: PotConfig) => (await potBalances(p)).metisWei))(pot);
  if (metis < COLLECT_MIN_METIS_WEI) {
    summary.paused = "pot short of METIS for fees";
    return summary;
  }

  const repaid = deps.repaid ?? recordRepayment;
  const missed = deps.missed ?? recordMissedRepayment;
  let sent = 0;
  for (const adv of active) {
    if (sent >= limit) break;
    let outstanding = BigInt(adv.outstandingBase);
    if (outstanding <= BigInt(0)) continue;
    const borrower = getAddress(adv.borrowerWallet);
    const seen = (deps.considered ?? consideredSubmissions)(adv.id);
    const due = (deps.payouts ?? metisPayoutsSince)(adv.borrowerWallet, adv.createdAt).filter((p) => !seen.has(p.submissionId));
    for (const p of due) {
      if (sent >= limit || outstanding <= BigInt(0)) break;
      const share = splitForAdvance(p.amountBase, outstanding, adv.waterfallBps).repayBase;
      if (share <= BigInt(0)) continue;
      const [approved, held] = await Promise.all([(deps.allowance ?? allowanceToPot)(pot, borrower), (deps.balanceOf ?? usdcBalanceOf)(pot, borrower)]);
      const amount = [share, approved, held].reduce((m, v) => (v < m ? v : m));
      if (amount <= BigInt(0)) {
        missed({ advanceId: adv.id, submissionId: p.submissionId, note: approved <= BigInt(0) ? "the approval was withdrawn" : "the payout had already left the wallet" });
        summary.missed++;
        continue;
      }
      let hash: Hash;
      try {
        hash = await (deps.collect ?? potCollectUsdc)(pot, borrower, amount);
      } catch (e) {
        // Refused in simulation: nothing was sent and nothing is owed for trying.
        missed({ advanceId: adv.id, submissionId: p.submissionId, note: `could not collect: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}` });
        summary.missed++;
        continue;
      }
      sent++;
      let status: "success" | "reverted" | "unknown" = "unknown";
      try {
        status = await (deps.receipt ?? potReceipt)(hash);
      } catch {
        /* unknown: counted as collected below, the reading that can only ever favour the borrower */
      }
      if (status === "reverted") {
        missed({ advanceId: adv.id, submissionId: p.submissionId, note: `collection reverted (${hash})` });
        summary.missed++;
        continue;
      }
      // Success, or sent and not yet confirmed. Recording an unconfirmed collection as paid can only ever
      // under-collect (a lender's loss); leaving it unrecorded could collect the same share twice.
      const r = repaid({ advanceId: adv.id, submissionId: p.submissionId, amountBase: amount, escrowTx: hash });
      outstanding = r.remainingBase;
      summary.collected++;
      summary.collectedBase += Number(amount);
    }
  }
  return summary;
}
