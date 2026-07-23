import "server-only";

import { getAddress } from "viem";
import { getVaultState } from "@/lib/deputy/chain";
import { recordEventOnce, updateSubmission } from "@/lib/db/campaigns";
import { nowSeconds } from "@/lib/db/keys";
import { short } from "@/lib/format";
import type { Campaign, Submission } from "@/lib/db/schema";
import { verifyReplayPermit } from "@/lib/deputy/replay-permit";
import { chargeOperatorFee } from "@/lib/x402/fees";
import { announceCampaignBlocked, announceCampaignSettled } from "@/lib/telegram/bot";
import { notifyFounderSettled } from "@/lib/telegram/founder-notify";
import {
  settleWithRecovery,
  type SettleOutcome,
  type VaultStrategyDeps,
} from "./settle";
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
  deps: VaultStrategyDeps = {},
): Promise<SettleFlowResult> {
  // Phase 5 — CENTRAL replay permit. This is the sole broadcast sink; a policy-required canary action submission
  // may only settle when the durable journal proves every required probe reproduced. No path (deputy, cron,
  // manual decide/settle) can reach settleWithRecovery without the permit. Fail closed — never broadcast.
  const permit = verifyReplayPermit(campaign, submission, deps.payoutReplay?.journal);
  if (!permit.ok) {
    return { outcome: { settled: false, reason: `action_replay_permit_denied:${permit.reason}` } as SettleOutcome, vault: null };
  }

  const outcome = await settleWithRecovery(campaign, submission, deps);

  // Vendor adds (Sage-owned AND founder-owned) are journaled from the chain by
  // the reconciler — never from here — so the journal is trustless.
  await reconcileVendorEvents(campaign.vaultAddress, campaign.chainId).catch(() => null);

  if (outcome.settled && outcome.txHash) {
    // Order matters for crash-safe exactly-once: journal + fee (both idempotent by
    // the payout tx) are made durable FIRST, and the submission is marked `paid`
    // LAST. A crash before `paid` re-enters this path on the next run and re-applies
    // every effect as a no-op; nothing double-counts (the settled journal dedupes by
    // (kind, txHash); the fee dedupes by settleTx).
    recordEventOnce({
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
    // DM the founder who launched this campaign from Telegram (best-effort, one retry).
    void notifyFounderSettled(campaign, submission, outcome);
    // LAST: mark paid only after the durable effects above are recorded.
    updateSubmission(submission.id, {
      status: "paid",
      payoutTx: outcome.txHash,
      decidedAt: nowSeconds(),
    });
  } else if (!outcome.needsOwnerAdd) {
    // Idempotent by (kind, txHash) when a rejection tx exists, so a re-fire of a
    // recorded rejection never double-journals it.
    recordEventOnce({
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
