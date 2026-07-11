import "server-only";

import { getAddress } from "viem";
import { getVaultState } from "@/lib/deputy/chain";
import { recordEvent, updateSubmission } from "@/lib/db/campaigns";
import { nowSeconds } from "@/lib/db/keys";
import { short } from "@/lib/format";
import type { Campaign, Submission } from "@/lib/db/schema";
import { chargeOperatorFee } from "@/lib/x402/fees";
import { announceCampaignBlocked, announceCampaignSettled } from "@/lib/telegram/bot";
import { settleWithRecovery, type SettleOutcome } from "./settle";
import { reconcileVendorEvents } from "./reconcile";

export interface SettleFlowResult {
  outcome: SettleOutcome;
  vault: { budget: number; spent: number; remaining: number } | null;
}

/**
 * Settle one approved submission, persist the result, and journal every real
 * on-chain consequence (allowlist add, settle, or block). Shared by the decide
 * route's approve branch and the standalone settle route (the founder-vault
 * re-fire after the owner allowlists the recipient), so both behave identically.
 */
export async function settleApprovedSubmission(
  campaign: Campaign,
  submission: Submission,
): Promise<SettleFlowResult> {
  const outcome = await settleWithRecovery(campaign, submission);

  // Vendor adds (Sage-owned AND founder-owned) are journaled from the chain by
  // the reconciler — never from here — so the journal is trustless.
  await reconcileVendorEvents(campaign.vaultAddress, campaign.chainId).catch(() => null);

  if (outcome.settled && outcome.txHash) {
    updateSubmission(submission.id, {
      status: "paid",
      payoutTx: outcome.txHash,
      decidedAt: nowSeconds(),
    });
    recordEvent({
      campaignId: campaign.id,
      submissionId: submission.id,
      kind: "settled",
      detail: short(outcome.recipient),
      txHash: outcome.txHash,
      amount: outcome.amountBase,
    });
    // RAIL 2 — record the operator fee owed for this payout. Records only (never
    // pays here), never throws — the payout is already done and must not be
    // affected. The sweep pays pending fees over the real x402 rail.
    chargeOperatorFee(outcome.txHash, {
      campaignId: campaign.id,
      submissionId: submission.id,
    });
    // Public per-campaign announce (opt-in via announceChatId). Outbound only,
    // never throws, journals nothing — fire-and-forget so it can't delay settle.
    void announceCampaignSettled(campaign, outcome);
  } else if (!outcome.needsOwnerAdd) {
    recordEvent({
      campaignId: campaign.id,
      submissionId: submission.id,
      kind: "blocked",
      detail: outcome.reason,
      txHash: outcome.txHash,
      failedCheckIndex: outcome.failedCheckIndex,
    });
    void announceCampaignBlocked(campaign, outcome);
  }

  const vault = await getVaultState(getAddress(campaign.vaultAddress), campaign.chainId)
    .then((s) => ({ budget: s.budget, spent: s.spent, remaining: s.remaining }))
    .catch(() => null);

  return { outcome, vault };
}
