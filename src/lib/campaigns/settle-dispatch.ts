import "server-only";

import type { Campaign, Submission } from "@/lib/db/schema";
import { settleOnStarknet } from "./settle-starknet";
import { settleApprovedSubmission, type SettleFlowResult } from "./settle-flow";
import type { VaultStrategyDeps } from "./vault-strategy";

/**
 * What every caller of settlement needs to know, on either rail.
 *
 * The EVM outcome carries fields that describe the V1/V2 vendor-allowlist mechanism. A Cairo vault
 * has no such mechanism, so those read false/null here — that is a true statement about the rail,
 * not a placeholder. `amountBase` is real on both.
 */
export interface RailSettleOutcome {
  settled: boolean;
  txHash: string | null;
  explorerUrl: string | null;
  reason: string | null;
  recipient: string | null;
  amountBase: number | null;
  /** EVM only: the vault's owner must allowlist the recipient before this can settle. */
  needsOwnerAdd: boolean;
  /** EVM only: which policy check soft-rejected the spend. */
  failedCheckIndex: number | null;
}

export interface RailSettleResult {
  outcome: RailSettleOutcome;
  /** The viem-read CampaignVault state. Null on Starknet: a Cairo vault is not one. */
  vault: SettleFlowResult["vault"];
}

/**
 * WHICH RAIL SETTLES THIS SUBMISSION — decided in ONE place.
 *
 * `settleApprovedSubmission` is the EVM settlement flow, and it is frozen. Its strategy selector
 * already refuses a Cairo vault outright ("it must not reach the EVM settlement path"), so the
 * money was never at risk — but that refusal is a THROW at the END of the approve path, after the
 * submission has been marked approved and journalled. A founder clicking approve on a Starknet
 * submission got a 502 and no way forward, and the same for the standalone settle route and the
 * Telegram and admin review tools.
 *
 * The sweep and the deputy pipeline each already branched on the rail, inline and separately. The
 * branch belongs in one place, and every caller belongs on it — including the next one somebody
 * adds, which is what settle-dispatch.test.ts checks.
 *
 * Wrapping rather than editing keeps the frozen flow byte-identical for every EVM campaign.
 */
export async function settleByRail(
  campaign: Campaign,
  submission: Submission,
  deps: VaultStrategyDeps = {},
): Promise<RailSettleResult> {
  if (campaign.settlementRail === "starknet") {
    const o = await settleOnStarknet(campaign, submission);
    return {
      outcome: {
        settled: o.settled,
        txHash: o.txHash,
        explorerUrl: o.explorerUrl,
        reason: o.reason,
        recipient: o.recipient,
        amountBase: o.rewardBase === null ? null : Number(o.rewardBase),
        needsOwnerAdd: false,
        failedCheckIndex: null,
      },
      vault: null,
    };
  }
  const { outcome, vault } = await settleApprovedSubmission(campaign, submission, deps);
  return {
    outcome: {
      settled: outcome.settled,
      txHash: outcome.txHash,
      explorerUrl: outcome.explorerUrl,
      reason: outcome.reason,
      recipient: outcome.recipient,
      amountBase: outcome.amountBase,
      needsOwnerAdd: outcome.needsOwnerAdd,
      failedCheckIndex: outcome.failedCheckIndex,
    },
    vault,
  };
}
