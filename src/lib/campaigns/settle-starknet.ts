import "server-only";

import { updateSubmission } from "@/lib/db/campaigns";
import { nowSeconds } from "@/lib/db/keys";
import type { Campaign, Submission } from "@/lib/db/schema";
import { payDirect } from "@/lib/starknet/pay";

/**
 * SETTLING ON STARKNET — the sibling of settle-flow, not a modification of it.
 *
 * The EVM rail settles by asking a founder-owned CampaignVault to release a reward: the vault
 * derives the amount, checks its own caps, and emits the event that is the source of truth. None
 * of that machinery exists here. There is no per-campaign vault on Starknet, so this path is
 * deliberately separate rather than bent to fit — bending it would mean touching the frozen
 * settlement code that makes the EVM rail safe.
 *
 * WHAT REPLACES THE VAULT'S GUARANTEES. The vault's job is to stop the agent overspending. Here
 * that is enforced before the transaction rather than by it:
 *
 *   · the amount comes from the campaign's own reward, never from a model and never recomputed;
 *   · the recipient is the address on the submission, never one supplied at settle time;
 *   · a submission already carrying a payout tx is refused outright, which is what makes a
 *     re-fire safe — the sweep re-evaluates pending work and must never pay twice.
 *
 * That is a weaker guarantee than the vault's and it is stated plainly rather than glossed: on
 * this rail Sage's own key is the limit, so the balance it holds IS the cap. Fund it accordingly.
 */

export interface StarknetSettleOutcome {
  settled: boolean;
  txHash: string | null;
  explorerUrl: string | null;
  reason: string | null;
  recipient: string | null;
  rewardBase: bigint | null;
}

const held = (reason: string): StarknetSettleOutcome => ({
  settled: false,
  txHash: null,
  explorerUrl: null,
  reason,
  recipient: null,
  rewardBase: null,
});

/** Starknet addresses are felts: 0x and up to 64 hex digits. An EVM address is not one. */
const isStarknetAddress = (v: string): boolean => /^0x[0-9a-fA-F]{1,64}$/.test(v);

/**
 * Pay one approved submission on Starknet.
 *
 * Never throws for control flow — every refusal is a `settled: false` with a reason, so the caller
 * can hold the submission for the next sweep exactly as it does on the EVM rail.
 */
export async function settleOnStarknet(
  campaign: Campaign,
  submission: Submission,
): Promise<StarknetSettleOutcome> {
  if (campaign.sandbox) return held("sandbox — payment structurally disabled");

  // Idempotency. The sweep re-evaluates pending work on a timer, and a submission that already
  // carries a payout tx has been paid; paying again would be a second real transfer with no way
  // back. This is the single most important check on this file.
  if (submission.payoutTx) return held("already settled");
  if (submission.status === "paid") return held("already paid");

  const recipient = submission.wallet?.trim() ?? "";
  if (!isStarknetAddress(recipient)) {
    // Not a failure of the worker's: it means this campaign was funded on the wrong rail for the
    // address on file, and paying an EVM address on Starknet would send money nowhere.
    return held(`recipient is not a Starknet address: ${recipient || "(none)"}`);
  }

  // The reward is the campaign's, in 6-decimal base units — the same units USDC moves in on
  // Starknet, so it is passed through with no conversion and nothing to round.
  const rewardBase = BigInt(campaign.rewardAmount);
  if (rewardBase <= BigInt(0)) return held("campaign reward is not a positive amount");

  try {
    const result = await payDirect([{ recipient, amountBase: rewardBase }]);
    updateSubmission(submission.id, {
      status: "paid",
      payoutTx: result.transactionHash,
      decidedAt: nowSeconds(),
    });
    return {
      settled: true,
      txHash: result.transactionHash,
      explorerUrl: `https://voyager.online/tx/${result.transactionHash}`,
      reason: null,
      recipient,
      rewardBase,
    };
  } catch (err) {
    // Held, not failed: the next sweep retries. The submission is left untouched, so nothing here
    // can leave it marked paid without a transaction behind it.
    return held(err instanceof Error ? err.message : "starknet settlement failed");
  }
}
