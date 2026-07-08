import "server-only";

import { getAddress } from "viem";
import { short, usd } from "@/lib/format";
import { encodeDetail } from "@/lib/campaigns/journal";
import type { Campaign, Submission } from "@/lib/db/schema";
import {
  casSubmissionStatus,
  getCampaign,
  getDecisionBySubmission,
  getSubmission,
  recordEvent,
  updateSubmission,
} from "@/lib/db/campaigns";
import { getVaultState, isVendorApproved } from "@/lib/deputy/chain";
import { settleApprovedSubmission } from "@/lib/campaigns/settle-flow";
import { ensureDecision } from "./decisions";
import { gateFromBrief } from "./autopilot";
import { notifyTelegram } from "./notify";
import { mainnetAutopilotEnabled } from "@/lib/env";
import { agentLog, newCorrelationId } from "./agent-log";

/**
 * The autonomy pipeline. `runDeputyOnSubmission` is the ONE place the Deputy
 * decides to act on its own — and it acts only inside a mandate the human already
 * confirmed. It never signs governance: on a founder vault where the recipient
 * isn't allowlisted it HOLDS for the owner's signature. Every payout is a real
 * `requestSpend` the vault can still reject; the pre-flight is a courtesy so we
 * don't burn a tx we can predict will fail, but the vault is the enforcement.
 *
 * It never throws for control flow and never retry-loops a spend: any failure
 * resets the submission to pending for human review. Every run carries one
 * correlationId (see agent-log.ts) threaded through decision → gate → preflight →
 * cas → settle → journal, so a single run is greppable end-to-end.
 */

export type PipelineAction = "skipped" | "held" | "settled";

export interface PipelineResult {
  action: PipelineAction;
  reason: string;
  txHash?: string | null;
  /** the correlation id for this run — lets callers thread it into their logs. */
  correlationId?: string;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
}

/**
 * Courtesy pre-flight against live vault state. A pass here is not a guarantee —
 * a race can still produce a real on-chain SpendRejected, which we surface
 * honestly — it just avoids a tx we can already see will fail. An UNREADABLE
 * vault (RPC failure) holds rather than proceeds: we won't fire a settle we
 * couldn't pre-check, and the submission stays pending so the next sweep retries
 * once the RPC recovers (self-healing, no lost work).
 */
async function preflight(
  campaign: Campaign,
  submission: Submission,
): Promise<{ ok: boolean; reason: string }> {
  const amount = campaign.rewardAmount / 1_000_000; // whole USDC
  const vault = getAddress(campaign.vaultAddress);

  let state;
  try {
    state = await getVaultState(vault, campaign.chainId);
  } catch {
    return {
      ok: false,
      reason: "vault state temporarily unreadable — held for review",
    };
  }
  if (state.status !== "active") return { ok: false, reason: "the vault is not active" };
  if (state.remaining < amount) return { ok: false, reason: "not enough remaining budget" };
  if (state.perTxCap < amount) return { ok: false, reason: "amount exceeds the per-payout cap" };
  if (state.velocityCap < amount) return { ok: false, reason: "amount exceeds the 24h velocity cap" };

  // A founder vault where the recipient isn't allowlisted needs the OWNER's
  // signature — the Deputy never signs governance. Hold for it.
  if (!campaign.ownerIsSage) {
    const approved = await isVendorApproved(
      vault,
      getAddress(submission.wallet),
      campaign.chainId,
    ).catch(
      () => true, // can't read → don't block on the courtesy; let settle surface it
    );
    if (!approved) return { ok: false, reason: "awaiting owner allowlist signature" };
  }
  return { ok: true, reason: "" };
}

function journalHeld(
  campaign: Campaign,
  submission: Submission,
  reason: string,
  cid?: string,
): void {
  recordEvent({
    campaignId: campaign.id,
    submissionId: submission.id,
    kind: "autopay_held",
    detail: encodeDetail(`${short(submission.wallet)} · ${reason}`, { cid }),
  });
  void notifyTelegram(
    `⏸️ <b>Held by Deputy</b>\n${campaign.title}\n${usd(campaign.rewardAmount / 1_000_000)} → ${short(submission.wallet)}\n${reason}\n${appUrl()}/app`,
  );
}

export async function runDeputyOnSubmission(
  submissionId: string,
): Promise<PipelineResult> {
  const cid = newCorrelationId();

  // a. load submission + campaign + decision (compute via brain if missing)
  const submission = getSubmission(submissionId);
  if (!submission) return { action: "skipped", reason: "no submission", correlationId: cid };
  const campaign = getCampaign(submission.campaignId);
  if (!campaign) return { action: "skipped", reason: "no campaign", correlationId: cid };
  agentLog(cid, "start", {
    submissionId,
    campaignId: campaign.id,
    autonomy: campaign.autonomy,
    status: submission.status,
  });

  const brief = await ensureDecision(submissionId, { cid }).catch(() => null);
  if (!brief) {
    agentLog(cid, "decision", { ok: false });
    return { action: "skipped", reason: "no decision", correlationId: cid };
  }
  const decisionRow = getDecisionBySubmission(submissionId);
  agentLog(cid, "decision", {
    engine: brief.engine,
    recommendation: brief.recommendation,
    confidence: brief.confidence,
  });

  // b. gate — the exact autopilot conditions (mainnet real-money campaigns need
  // DEPUTY_AUTOPILOT_MAINNET armed, else they hold for manual approval).
  const gate = gateFromBrief(
    brief,
    campaign,
    submission.status,
    mainnetAutopilotEnabled(),
  );
  agentLog(cid, "gate", { pay: gate.pay, reason: gate.reason });
  if (!gate.pay) {
    // Only journal a hold for an autopilot campaign on a still-pending item;
    // a manual campaign (or an already-handled item) is just a silent skip.
    if (campaign.autonomy === "autopilot" && submission.status === "pending") {
      journalHeld(campaign, submission, gate.reason, cid);
      return { action: "held", reason: gate.reason, correlationId: cid };
    }
    return { action: "skipped", reason: gate.reason, correlationId: cid };
  }

  // c. pre-flight courtesy policy read
  const pf = await preflight(campaign, submission);
  agentLog(cid, "preflight", { ok: pf.ok, reason: pf.reason });
  if (!pf.ok) {
    journalHeld(campaign, submission, pf.reason, cid);
    return { action: "held", reason: pf.reason, correlationId: cid };
  }

  // f. CAS pending → settling BEFORE any chain write. If we lose, another runner
  // owns it — exit silently, no double-settle.
  const won = casSubmissionStatus(submissionId, "pending", "settling");
  agentLog(cid, "cas", { won });
  if (!won) {
    return { action: "skipped", reason: "another runner owns it", correlationId: cid };
  }

  // e. settle through the EXISTING settle-flow (intentHash idempotency). On a
  // founder vault where the recipient isn't approved this returns needsOwnerAdd
  // (it never signs the add). Any failure → hold; never retry-loop.
  try {
    const { outcome } = await settleApprovedSubmission(campaign, submission);
    if (outcome.settled && outcome.txHash) {
      const conf = Math.round(brief.confidence * 100);
      recordEvent({
        campaignId: campaign.id,
        submissionId,
        kind: "autopay_settled",
        detail: encodeDetail(
          `${short(outcome.recipient)} · ${conf}% · dec ${decisionRow?.id ?? "—"}`,
          { cid },
        ),
        txHash: outcome.txHash,
        amount: outcome.amountBase,
      });
      agentLog(cid, "settle", {
        action: "settled",
        tx: outcome.txHash,
        amountBase: outcome.amountBase,
      });
      void notifyTelegram(
        `✅ <b>Paid by Deputy</b>\n${campaign.title}\n${usd(outcome.amountBase / 1_000_000)} → ${short(outcome.recipient)} · ${conf}% confidence\n${appUrl()}/proof/${outcome.txHash}`,
      );
      return { action: "settled", reason: "paid", txHash: outcome.txHash, correlationId: cid };
    }

    // Not settled: reset to pending for human review, journal the honest reason.
    updateSubmission(submissionId, { status: "pending", decidedAt: null });
    const reason = outcome.needsOwnerAdd
      ? "awaiting owner allowlist signature"
      : (outcome.reason ?? "blocked on-chain");
    journalHeld(campaign, submission, reason, cid);
    agentLog(cid, "settle", { action: "held", reason });
    return { action: "held", reason, correlationId: cid };
  } catch (err) {
    console.error("[pipeline] settle failed:", err);
    updateSubmission(submissionId, { status: "pending", decidedAt: null });
    journalHeld(campaign, submission, "settlement error — needs review", cid);
    agentLog(cid, "settle", {
      action: "held",
      reason: "settlement error",
      error: err instanceof Error ? err.message : String(err),
    });
    return { action: "held", reason: "settlement error", correlationId: cid };
  }
}
