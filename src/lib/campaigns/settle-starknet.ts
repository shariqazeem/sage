import "server-only";

import { updateSubmission } from "@/lib/db/campaigns";
import { nowSeconds } from "@/lib/db/keys";
import type { Campaign, Submission } from "@/lib/db/schema";
import { derivePayoutIntent } from "@/lib/campaigns/settle-core";
import { getDecisionBySubmission } from "@/lib/db/campaigns";
import { requestVaultPayout } from "@/lib/starknet/vault";
import { feltOf, toFelt } from "@/lib/starknet/felt";

/**
 * SETTLING ON STARKNET — the sibling of settle-flow, not a modification of it.
 *
 * The EVM rail settles by asking a founder-owned CampaignVault to release a reward: the vault
 * derives the amount, checks its own caps, and emits the event that is the source of truth. None
 * of that machinery exists here. There is no per-campaign vault on Starknet, so this path is
 * deliberately separate rather than bent to fit — bending it would mean touching the frozen
 * settlement code that makes the EVM rail safe.
 *
 * THE VAULT IS REQUIRED, NOT PREFERRED. An earlier version of this paid from Sage's own balance
 * when a campaign had no vault, and stated honestly that the balance was therefore the only cap.
 * That is a materially weaker promise than the EVM rail's, and offering it as a silent fallback
 * meant a campaign could end up on the weaker footing without anyone choosing it. A Starknet
 * campaign without a vault now HOLDS: the guarantee is the product, so its absence is a reason to
 * stop rather than a reason to proceed carefully.
 *
 * WHAT THE VAULT ENFORCES, that this file cannot: Sage names a mission and the vault looks up what
 * it pays, so no caller supplies an amount; the intent makes the authorisation single-use on
 * chain, not merely in our database; and the founder can revoke and withdraw at any moment without
 * asking Sage. What this file still checks — an already-settled submission, a recipient that is
 * actually a Starknet address — exists so a doomed request never costs a transaction.
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
 * The felt arithmetic lives in `@/lib/starknet/felt`, shared with the founder-side deploy flow.
 * The browser writes a mission under a felt and settlement looks it up under one; if those two
 * derivations ever disagreed the vault would answer NO_SUCH_MISSION after the work was done.
 */

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
  // Starknet, so it is passed through with no conversion and nothing to round. It is reported for
  // the receipt only: the VAULT derives what actually moves.
  const rewardBase = BigInt(campaign.rewardAmount);
  if (rewardBase <= BigInt(0)) return held("campaign reward is not a positive amount");

  if (campaign.vaultKind !== "sage_vault_starknet") {
    return held("this campaign has no Starknet vault — nothing can be released from it");
  }
  const vaultAddress = campaign.vaultAddress?.trim() ?? "";
  if (!isStarknetAddress(vaultAddress)) {
    return held(`the campaign's vault address is not a Starknet address: ${vaultAddress || "(none)"}`);
  }

  // A mission-bound campaign settles the mission the submission targeted; a legacy one has a
  // single implicit mission keyed by the campaign. Either way the vault holds the terms.
  const missionId = submission.missionIdHash ?? feltOf(campaign.id);
  const { payoutIntentHash, decisionDigest } = derivePayoutIntent(
    campaign,
    submission,
    getDecisionBySubmission(submission.id),
  );

  try {
    const result = await requestVaultPayout({
      vaultAddress,
      missionId: toFelt(missionId),
      recipient,
      // A decision digest is optional upstream (a legacy payout has none); the vault requires a
      // non-zero commitment, so fall back to the intent, which is itself decision-bound whenever a
      // decision exists.
      decisionDigest: toFelt(decisionDigest ?? payoutIntentHash),
      intentHash: toFelt(payoutIntentHash),
    });

    if (!result.paid) {
      // A refusal is a SUCCESSFUL transaction that moved nothing. Recording it as paid because the
      // transaction succeeded is the exact mistake this reads the events to avoid.
      return held(`the vault refused this payout: ${result.reason}`);
    }

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
