import "server-only";
import { getAddress, type Address } from "viem";
import {
  getCampaign,
  getSubmission,
  listSubmissions,
  getDecisionBySubmission,
  recordEvent,
  updateSubmission,
} from "@/lib/db/campaigns";
import { settleApprovedSubmission } from "./settle-flow";
import { reasonSentence } from "@/lib/deputy/reason-copy";
import { v2Economics } from "./v2-economics";
import { canDecide, type SubmissionStatus } from "./status";
import { nowSeconds } from "@/lib/db/keys";
import { short } from "@/lib/format";
import type { Campaign } from "@/lib/db/schema";

/**
 * Founder review actions for a campaign's HELD work — the internal, auth-agnostic core
 * shared by the Telegram review tools and the ops script. A release lands in the SAME
 * settleApprovedSubmission the decide route + autopilot use, so it flows through the proven
 * V2 settle path (vault caps + replay protection + decoded outcome enforced there). No amount
 * is ever passed — the vault derives it.
 *
 * SAFETY: list output carries only safe fields — mission title, confidence %, a fixed coarse
 * class, and the public evidence URL. NEVER the submitter's note or the model's reason text.
 * Callers MUST check ownsCampaign before release/reject.
 */

export interface HeldItem {
  submissionId: string;
  missionTitle: string;
  confidencePct: number | null;
  reasonClass: string;
  /** the public evidence link the tester submitted — never the note. */
  evidenceUrl: string | null;
}

/** Does this wallet own the campaign? (checksum-agnostic compare against posterWallet). */
export function ownsCampaign(campaign: Campaign, wallet: string | null | undefined): boolean {
  if (!wallet) return false;
  try {
    return getAddress(campaign.posterWallet) === getAddress(wallet as Address);
  } catch {
    return false;
  }
}

/** Held (pending) submissions for a campaign — safe fields only, newest-first. */
export function listHeldSubmissions(campaign: Campaign): HeldItem[] {
  const titleByHash = new Map(
    v2Economics(campaign).missions.map((m) => [m.missionIdHash, m.title]),
  );
  return listSubmissions(campaign.id)
    .filter((s) => s.status === "pending")
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((s) => {
      const brief = getDecisionBySubmission(s.id)?.brief;
      return {
        submissionId: s.id,
        missionTitle: titleByHash.get(s.missionIdHash ?? "") ?? "Mission",
        confidencePct:
          typeof brief?.confidence === "number" ? Math.round(brief.confidence * 100) : null,
        // the REAL, fixed reason class as a plain-language sentence — identical everywhere it renders,
        // and never contradicting the confidence shown beside it. (Was a coarse recommendation string.)
        reasonClass: reasonSentence(brief?.reasonCode),
        evidenceUrl: s.evidenceUrl,
      };
    });
}

export interface ReviewSummary {
  submissionId: string;
  missionTitle: string;
  rewardBase: number;
  recipient: string;
}

/** The summary a founder confirms before a release — NO settle happens here. */
export function reviewSummary(
  campaign: Campaign,
  submissionId: string,
): ReviewSummary | { error: string } {
  const s = getSubmission(submissionId);
  if (!s || s.campaignId !== campaign.id) return { error: "submission not found in this campaign" };
  if (!canDecide(s.status as SubmissionStatus)) return { error: "this submission was already decided" };
  const mission = v2Economics(campaign).missions.find((m) => m.missionIdHash === s.missionIdHash);
  return {
    submissionId,
    missionTitle: mission?.title ?? "Mission",
    rewardBase: mission?.rewardBase ?? campaign.rewardAmount,
    recipient: s.wallet,
  };
}

type SettleFn = typeof settleApprovedSubmission;

export interface ReleaseResult {
  ok: boolean;
  settled?: boolean;
  txHash?: string | null;
  recipient?: string;
  amountBase?: number | null;
  reason?: string | null;
  needsOwnerAdd?: boolean;
  error?: string;
}

/**
 * Founder-approve a HELD submission into the EXISTING settle path. Mirrors the decide route's
 * approve branch exactly (approve → journal → settleApprovedSubmission), minus the SIWE gate —
 * the caller MUST have checked ownsCampaign. `settle` is injectable for tests only.
 */
export async function releaseSubmission(
  campaignId: string,
  submissionId: string,
  opts: { settle?: SettleFn } = {},
): Promise<ReleaseResult> {
  const settle = opts.settle ?? settleApprovedSubmission;
  const campaign = getCampaign(campaignId);
  if (!campaign) return { ok: false, error: "campaign not found" };
  const submission = getSubmission(submissionId);
  if (!submission || submission.campaignId !== campaignId) {
    return { ok: false, error: "submission not found" };
  }
  if (!canDecide(submission.status as SubmissionStatus)) {
    return { ok: false, error: "already decided" };
  }

  updateSubmission(submissionId, { status: "approved", decidedAt: nowSeconds() });
  recordEvent({
    campaignId,
    submissionId,
    kind: "submission_approved",
    detail: short(submission.wallet),
  });

  const { outcome } = await settle(campaign, submission);
  return {
    ok: true,
    settled: outcome.settled,
    txHash: outcome.txHash,
    recipient: outcome.recipient,
    amountBase: outcome.amountBase,
    reason: outcome.reason,
    needsOwnerAdd: outcome.needsOwnerAdd,
  };
}

/** Founder-reject a HELD submission — no payout. Mirrors the decide route's reject branch. */
export function rejectSubmission(
  campaignId: string,
  submissionId: string,
  why?: string,
): { ok: boolean; error?: string } {
  const campaign = getCampaign(campaignId);
  if (!campaign) return { ok: false, error: "campaign not found" };
  const submission = getSubmission(submissionId);
  if (!submission || submission.campaignId !== campaignId) {
    return { ok: false, error: "submission not found" };
  }
  if (!canDecide(submission.status as SubmissionStatus)) {
    return { ok: false, error: "already decided" };
  }

  const reason = typeof why === "string" ? why.trim().slice(0, 300) : null;
  updateSubmission(submissionId, {
    status: "rejected",
    rejectReason: reason,
    decidedAt: nowSeconds(),
  });
  recordEvent({
    campaignId,
    submissionId,
    kind: "submission_rejected",
    detail: short(submission.wallet),
  });
  return { ok: true };
}
