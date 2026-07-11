import "server-only";

import { getAddress, type Address, type Hash } from "viem";
import { ensureVendorApproved, submitRequestSpend } from "@/lib/deputy/signer";
import { failedCheckReason } from "@/lib/deputy/reasons";
import { submissionIntentHash } from "@/lib/db/keys";
import type { Campaign, Submission } from "@/lib/db/schema";

/**
 * The on-chain outcome of settling one approved submission. Everything the
 * review UI and the proof page need to render truthfully — including the honest
 * "we couldn't pay, and exactly why" paths.
 */
export interface SettleOutcome {
  settled: boolean;
  txHash: Hash | null;
  explorerUrl: string | null;
  /** The failing policy check (1..6) when a spend soft-rejects, else null. */
  failedCheckIndex: number | null;
  reason: string | null;
  /** true when the vault's owner (not our operator) must approve the recipient. */
  needsOwnerAdd: boolean;
  /** true when THIS call allowlisted the recipient server-side (we own the vault). */
  vendorAdded: boolean;
  /** the executeAddVendor tx hash, when we added the recipient. */
  vendorTxHash: Hash | null;
  recipient: Address;
  /** Reward in 6dp base units, echoed for the caller. */
  amountBase: number;
}

/**
 * Settle one approved submission: make sure the recipient is an allowlisted
 * vendor (adding it if we own the vault), then release the reward with the
 * operator key. The amount and recipient are the campaign's + submission's own —
 * never client-supplied — and the vault enforces policy regardless. The intent
 * hash is deterministic per (campaign, submission), so a settled event always
 * maps back to its submission and a re-run can't double-pay silently.
 */
export async function settleSubmission(args: {
  campaign: Campaign;
  submission: Submission;
}): Promise<SettleOutcome> {
  const { campaign, submission } = args;
  // HARD SANDBOX GUARD: a sandbox campaign (the public "try to jailbreak the
  // Deputy" box) can NEVER settle. This THROWS rather than returns, so any code
  // path that reaches a spend for a sandbox campaign fails loudly — payment is
  // structurally unreachable, not merely gated.
  if (campaign.sandbox) {
    throw new Error(
      `refusing to settle sandbox campaign ${campaign.id} — payment is structurally disabled`,
    );
  }
  const vault = getAddress(campaign.vaultAddress);
  const recipient = getAddress(submission.wallet);
  const amount = BigInt(campaign.rewardAmount);
  const intentHash = submissionIntentHash(campaign.id, submission.id);

  const vendor = await ensureVendorApproved(vault, recipient, campaign.chainId);
  if (!vendor.approved) {
    const reason =
      vendor.reason === "owner_must_add"
        ? "the recipient must be approved by the vault owner before payout"
        : vendor.reason === "timelock_pending"
          ? "the recipient's approval is still inside its timelock window"
          : "the recipient could not be approved for payout";
    return {
      settled: false,
      txHash: null,
      explorerUrl: null,
      failedCheckIndex: 3, // would fail the vendor check
      reason,
      needsOwnerAdd: vendor.reason === "owner_must_add",
      vendorAdded: false,
      vendorTxHash: null,
      recipient,
      amountBase: campaign.rewardAmount,
    };
  }

  const res = await submitRequestSpend({
    vault,
    vendor: recipient,
    amount,
    intentHash,
    chainId: campaign.chainId,
  });
  return {
    settled: res.settled,
    txHash: res.txHash,
    explorerUrl: res.explorerUrl,
    failedCheckIndex: res.failedCheckIndex,
    reason: res.settled ? null : failedCheckReason(res.failedCheckIndex),
    needsOwnerAdd: false,
    vendorAdded: vendor.added,
    vendorTxHash: vendor.txHashes.at(-1) ?? null,
    recipient,
    amountBase: campaign.rewardAmount,
  };
}
