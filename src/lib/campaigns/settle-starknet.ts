import "server-only";
import { starknetTxUrl } from "@/lib/starknet/explorer";

import { updateSubmission } from "@/lib/db/campaigns";
import { nowSeconds } from "@/lib/db/keys";
import type { Campaign, Submission } from "@/lib/db/schema";
import { starknetPayoutIntent } from "@/lib/starknet/payout-intent";
import { getDecisionBySubmission } from "@/lib/db/campaigns";
import { payoutRouteFor, requestVaultPayout } from "@/lib/starknet/vault";
import { escrowPayouts, type PayoutLeg } from "@/lib/starknet/claims";
import { getActiveAdvance, recordRepayment } from "@/lib/db/advances";
import { splitForAdvance } from "@/lib/advance/waterfall";
import { mintClaimSecrets } from "@/lib/starknet/claim-link";
import { starknetConfig } from "@/lib/starknet/config";
import { announceCampaignSettledStarknet } from "@/lib/telegram/bot";
import { notifyFounderSettled } from "@/lib/telegram/founder-notify";
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
/** How long a worker has to open their claim before Sage can take it back. */
const CLAIM_EXPIRY_SECONDS = 90 * 24 * 3600;

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
  /**
   * This rail derives its own commitments. The EVM one encodes the vault and recipient as ABI
   * `address` — twenty bytes — and a Starknet address is a felt, so `getAddress` threw on it long
   * before the encoder could. It only reaches that code when a DECISION EXISTS, which is why no
   * dry run or test ever hit it: none of them had judged work. It fired the first time a founder
   * released a held submission.
   */
  const decisionRow = getDecisionBySubmission(submission.id);
  const { payoutIntentHash, decisionDigest } = starknetPayoutIntent(
    campaign,
    submission,
    decisionRow
      ? {
          id: decisionRow.id,
          contentSha256: decisionRow.contentSha256 ?? null,
          recommendation: decisionRow.brief.recommendation,
          reasonCode: decisionRow.brief.reasonCode,
          confidence: decisionRow.brief.confidence,
          model: decisionRow.model ?? null,
        }
      : null,
  );

  /**
   * PUBLIC PAYOUT, OR ESCROWED BEHIND A CLAIM?
   *
   * Sage cannot pay into a shielded note. The privacy pool's viewing key lives in the WALLET and
   * only the wallet can reach the proving service, so no server will ever send shielded USDC the
   * way GOAT sends public USDC. A claim link is not a workaround for that — it is the only shape a
   * private payout can take: the vault releases the reward to Sage, Sage escrows it behind a
   * commitment, and the worker opens it themselves, publicly or privately, to any address.
   *
   * The route is decided by the vault's CLASS, never by preference. A vault predating the split
   * has no `request_payout_to`, and asking it reverts as an unknown selector — a cleared worker
   * who cannot be paid. Those campaigns keep paying publicly, exactly as they did before.
   */
  const route = await payoutRouteFor(vaultAddress);
  const cfg = starknetConfig();
  const escrowTarget = route === "split" ? cfg?.accountAddress : null;
  // Minted BEFORE the vault is asked, so the money is never released without a commitment to
  // escrow it behind. Sage holds the refund secret; the worker gets the claim secret.
  const secrets = escrowTarget ? mintClaimSecrets() : null;

  try {
    const result = await requestVaultPayout({
      vaultAddress,
      missionId: toFelt(missionId),
      recipient,
      // On the private route the vault pays SAGE, which escrows it in the same breath. The worker
      // stays the vault's replay key and the name on the receipt, so a two-slot mission still pays
      // two different people — that is the whole reason the entrypoint was split.
      payoutTarget: escrowTarget ?? undefined,
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

    /**
     * THE ESCROW LEG. The vault has released the reward to Sage; nothing is owed to the worker
     * until it sits behind their commitment.
     *
     * Ordered vault-first on purpose. If the escrow fails here, Sage is holding money the vault
     * has already accounted for — recoverable, and nobody has been told they were paid. The
     * reverse order would escrow from Sage's own float, unbounded by the vault, which is exactly
     * the guarantee this product is built on.
     */
    if (secrets && escrowTarget) {
      /**
       * THE WATERFALL (capital-in, 2026-09-01 — explicit user authorization for this frozen file).
       *
       * When the earner holds an active advance, the escrow splits into TWO claim legs in the same
       * `deposit_many`: the pot's repayment slice and the worker's remainder. Nothing above this
       * point changes — the vault released the full reward exactly as always, and the split
       * happens where the money was already being escrowed. All bigint, floor toward the worker
       * (splitForAdvance), capped by the outstanding balance.
       *
       * The recourse this implements, stated honestly: repayment routes from SAGE-WITNESSED inflow
       * only. A borrower who stops earning here stops repaying here — that is the published deal,
       * not a hidden lien on a person.
       */
      const advance = getActiveAdvance(submission.wallet ?? "");
      const split = advance
        ? splitForAdvance(rewardBase, BigInt(advance.outstandingBase), advance.waterfallBps)
        : null;
      // Pot secrets are minted ONLY when a repayment leg exists; the worker keeps `secrets`.
      const potSecrets = split && split.repayBase > BigInt(0) ? mintClaimSecrets() : null;
      try {
        const legs: PayoutLeg[] = [];
        // The worker's leg. A 100%-waterfall payout can route entirely to repayment — then there
        // is no worker leg at all, because the Cairo contract refuses a zero-amount deposit and a
        // zero claim would be a link that opens onto nothing.
        const workerBase = split ? split.workerBase : rewardBase;
        if (workerBase > BigInt(0)) {
          legs.push({
            claimCommitment: secrets.claimCommitment,
            refundCommitment: secrets.refundCommitment,
            amountBase: workerBase,
          });
        }
        if (potSecrets && split) {
          legs.push({
            claimCommitment: potSecrets.claimCommitment,
            refundCommitment: potSecrets.refundCommitment,
            amountBase: split.repayBase,
          });
        }
        const escrow = await escrowPayouts(
          legs,
          Math.floor(Date.now() / 1000) + CLAIM_EXPIRY_SECONDS,
        );
        if (potSecrets && split && advance) {
          try {
            recordRepayment({
              advanceId: advance.id,
              submissionId: submission.id,
              amountBase: split.repayBase,
              claimCommitment: potSecrets.claimCommitment,
              claimSecret: potSecrets.claimSecret,
              escrowTx: escrow.transactionHash,
            });
          } catch (ledgerErr) {
            /**
             * The money IS escrowed; only the ledger write failed. The pot's secret must not be
             * lost with it — an unrecorded secret is stranded money — so it goes to the error log
             * verbatim for operator recovery, and settlement still completes: the worker was paid
             * and nothing about THEIR money is in doubt.
             */
            console.error(
              "[settle-starknet] REPAYMENT LEDGER WRITE FAILED — recover manually:",
              JSON.stringify({
                advanceId: advance.id,
                submissionId: submission.id,
                amountBase: split.repayBase.toString(),
                claimCommitment: potSecrets.claimCommitment,
                claimSecret: potSecrets.claimSecret,
                escrowTx: escrow.transactionHash,
              }),
              ledgerErr,
            );
          }
        }
        updateSubmission(submission.id, {
          status: "paid",
          payoutTx: result.transactionHash,
          // No worker leg (full-waterfall payout) → no claim link to show; the record's repayment
          // history is the receipt for where the money went.
          claimSecret: workerBase > BigInt(0) ? secrets.claimSecret : null,
          claimCommitment: workerBase > BigInt(0) ? secrets.claimCommitment : null,
          claimEscrowTx: escrow.transactionHash,
          decidedAt: nowSeconds(),
        });
        return {
          settled: true,
          txHash: result.transactionHash,
          explorerUrl: starknetTxUrl(result.transactionHash) ?? "",
          reason: null,
          recipient,
          rewardBase,
        };
      } catch (err) {
        // The vault paid and the escrow did not. Held, never failed: the submission stays
        // unsettled so the next sweep retries, and the reason names what happened rather than
        // reporting a payout the worker cannot reach.
        return held(
          `the vault released the reward but escrowing it behind a claim failed — ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    updateSubmission(submission.id, {
      status: "paid",
      payoutTx: result.transactionHash,
      decidedAt: nowSeconds(),
    });

    /**
     * TELL THE PEOPLE A PAYOUT CONCERNS — from the settler, so every caller gets it.
     *
     * The EVM rail announces and DMs from inside settle-flow, so all five of its entry points are
     * covered by construction. On this rail the announce lived in ONE caller (the deputy
     * pipeline), which meant a payout settled by the sweep, the decide route or a review tool told
     * nobody anything.
     *
     * Latent rather than live: both Starknet campaigns today have no announce chat and a founder
     * with no Telegram binding, so nothing was actually missed. It is fixed here so the rails are
     * symmetric BEFORE one of those is set, rather than after someone notices the silence.
     *
     * Fire-and-forget on purpose, exactly as the EVM path does it: the money has already moved and
     * a messaging failure must never affect a completed payout.
     */
    void announceCampaignSettledStarknet(campaign, {
      txHash: result.transactionHash,
      recipient,
      amountBase: Number(rewardBase),
      explorerUrl: starknetTxUrl(result.transactionHash) ?? "",
    });
    void notifyFounderSettled(campaign, submission, {
      settled: true,
      txHash: result.transactionHash as `0x${string}`,
      explorerUrl: starknetTxUrl(result.transactionHash) ?? "",
      failedCheckIndex: null,
      reason: null,
      needsOwnerAdd: false,
      vendorAdded: false,
      vendorTxHash: null,
      recipient: recipient as `0x${string}`,
      amountBase: Number(rewardBase),
    });

    return {
      settled: true,
      txHash: result.transactionHash,
      explorerUrl: starknetTxUrl(result.transactionHash) ?? "",
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
