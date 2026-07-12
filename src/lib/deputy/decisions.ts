import "server-only";

import { short } from "@/lib/format";
import { encodeDetail } from "@/lib/campaigns/journal";
import {
  deleteDecision,
  getCampaign,
  getDecisionBySubmission,
  getMissionByHash,
  getSubmission,
  insertDecision,
  recomputeMissionSpecDigest,
  recordEvent,
} from "@/lib/db/campaigns";
import type { Decision, Submission } from "@/lib/db/schema";
import { verifyEvidence } from "@/lib/x402/verify-evidence";
import { deriveStoredX402Status } from "@/lib/x402/x402-status";
import { verifySubmission } from "./brain";
import type { DecisionBrief, StoredBrief } from "./brain-core";

/** Rebuild the full brief (content + provenance) from a stored decision row. */
export function briefFromRow(row: Decision): DecisionBrief {
  return {
    ...row.brief,
    engine: row.engine === "llm" ? "llm" : "heuristic",
    model: row.model,
    // reasonCode + provider were added later; default them for pre-existing rows.
    reasonCode: row.brief.reasonCode ?? "unknown",
    provider: row.brief.provider ?? null,
    evidenceOk: row.evidenceOk,
    contentSha256: row.contentSha256,
    latencyMs: row.latencyMs,
    costUsd: row.costUsd,
    x402PaymentTx: row.x402PaymentTx,
    // x402_status/x402_reason were added later; historical rows derive honestly.
    x402Status: deriveStoredX402Status(row.x402Status, row.x402PaymentTx),
    x402Reason: (row.x402Reason as DecisionBrief["x402Reason"]) ?? null,
  };
}

/**
 * Fail-closed HOLD for a V2 submission whose locked mission context is missing (no
 * mission row, still a draft, or the campaign has no on-chain identity). A heuristic
 * hold NEVER auto-pays — the Deputy refuses to judge against nothing rather than
 * risk paying on empty criteria. Records the V2 provenance it does know.
 */
function holdForMissingMission(
  submission: Submission,
  campaignId: string,
  missionIdHash: string,
  cid?: string,
): DecisionBrief {
  const brief: StoredBrief = {
    criteria: [],
    fraudSignals: [
      {
        signal: "mission context unavailable",
        severity: "high",
        reason: "no locked mission specification to judge this submission against",
      },
    ],
    recommendation: "hold",
    reasonCode: "no_evidence",
    confidence: 0,
    summary:
      "Held: this campaign_v2 submission has no resolvable locked mission to judge against. A human must review the mission configuration.",
    provider: null,
  };
  const { row, inserted } = insertDecision({
    submissionId: submission.id,
    campaignId,
    engine: "heuristic",
    model: null,
    brief,
    contentSha256: null,
    evidenceOk: false,
    latencyMs: null,
    costUsd: null,
    x402PaymentTx: null,
    x402Status: "not_required",
    x402Reason: null,
    commitmentVersion: 2,
    missionIdHash,
    vaultKind: "campaign_v2",
  });
  if (inserted) {
    recordEvent({
      campaignId,
      submissionId: submission.id,
      kind: "decision_recorded",
      detail: encodeDetail(`Heuristic · hold · ${short(submission.wallet)} · missing mission`, { cid }),
    });
  }
  return row ? briefFromRow(row) : { ...brief, engine: "heuristic", model: null, evidenceOk: false, contentSha256: null, latencyMs: null, costUsd: null, x402PaymentTx: null, x402Status: "not_required", x402Reason: null };
}

/**
 * Compute — or return the already-stored — verification receipt for a
 * submission. Idempotent: an existing decision short-circuits the brain. The
 * pipeline is fetch evidence → run the brain → persist + journal, and it never
 * throws for control flow, so callers run it fire-and-forget after `submit`
 * (via `after()`) or best-effort on first view.
 *
 * §8 rule honored: the journal event is server-authored, emitted once (only when
 * this call actually inserted the row).
 */
export async function ensureDecision(
  submissionId: string,
  opts?: { force?: boolean; cid?: string },
): Promise<DecisionBrief | null> {
  const existing = getDecisionBySubmission(submissionId);
  if (existing && !opts?.force) return briefFromRow(existing);
  // force: the sweep retries a transient LLM failure (a heuristic receipt) by
  // dropping it and recomputing — so a recovered key can upgrade it to engine "llm".
  if (existing && opts?.force) deleteDecision(submissionId);

  const submission = getSubmission(submissionId);
  if (!submission) return null;
  const campaign = getCampaign(submission.campaignId);
  if (!campaign) return null;

  // For a V2 mission submission the UNIT of work is the MISSION — the Deputy must
  // judge against the locked mission's full context, never the (empty) campaign
  // criteria. Falls back to the campaign for V1.
  const isV2 = campaign.vaultKind === "campaign_v2" && !!submission.missionIdHash;
  const mission = isV2 ? getMissionByHash(campaign.id, submission.missionIdHash!) : null;

  // FAIL CLOSED: a V2 submission must be judged against its exact LOCKED mission
  // snapshot. HOLD (never judge against nothing) when the mission is unresolvable,
  // still a draft, missing its immutable fields (target surface), the campaign lacks
  // its on-chain identity, or the snapshot has DRIFTED from what the submission
  // captured (submission.missionSpecDigest != the current mission's recomputed digest).
  if (isV2) {
    const snapshotDrifted =
      !!mission &&
      !!campaign.campaignIdHash &&
      !!submission.missionSpecDigest &&
      submission.missionSpecDigest.toLowerCase() !==
        recomputeMissionSpecDigest(mission, campaign.campaignIdHash).toLowerCase();
    if (
      !mission ||
      mission.status === "draft" ||
      !campaign.campaignIdHash ||
      !mission.targetSurface ||
      snapshotDrifted
    ) {
      return holdForMissingMission(submission, campaign.id, submission.missionIdHash!, opts?.cid);
    }
  }

  const judgeTitle = mission ? `${mission.title} — ${mission.objective}` : campaign.title;
  // The model judges the MISSION's ordered criteria PLUS its instructions, target
  // surface, and required-evidence as TRUSTED, founder-authored acceptance context —
  // all from the immutable locked mission snapshot, never from the untrusted note.
  // Reward is NEVER included — it is settlement policy, not a measure of evidence quality.
  const judgeCriteria = mission
    ? [
        `Task: ${mission.instructions}`,
        `Target surface: ${mission.targetSurface}`,
        ...mission.criteria,
        ...mission.evidenceList.map((e) => `Required evidence: ${e}`),
      ]
    : campaign.criteria;

  // RAIL 1 — the Deputy pays for verification when the x402 rail is live; a
  // direct (unpaid) fetch otherwise. `x402PaymentTx` is a real GOAT tx or null.
  const evidence = submission.evidenceUrl
    ? await verifyEvidence(submission.evidenceUrl)
    : {
        text: "",
        contentSha256: null,
        ok: false,
        failReason: "no evidence link",
        x402PaymentTx: null as string | null,
        x402Status: "not_required" as const,
        x402Reason: null,
      };

  const brief = await verifySubmission({
    campaignTitle: judgeTitle,
    criteria: judgeCriteria,
    conditionType: campaign.conditionType,
    note: submission.note,
    wallet: submission.wallet,
    evidenceUrl: submission.evidenceUrl,
    evidenceText: evidence.text,
    evidenceOk: evidence.ok,
    evidenceFailReason: evidence.failReason,
    contentSha256: evidence.contentSha256,
  });

  const { row, inserted } = insertDecision({
    submissionId,
    campaignId: campaign.id,
    engine: brief.engine,
    model: brief.model,
    brief: {
      criteria: brief.criteria,
      fraudSignals: brief.fraudSignals,
      recommendation: brief.recommendation,
      reasonCode: brief.reasonCode,
      confidence: brief.confidence,
      summary: brief.summary,
      provider: brief.provider,
    },
    contentSha256: brief.contentSha256,
    evidenceOk: brief.evidenceOk,
    latencyMs: brief.latencyMs,
    costUsd: brief.costUsd,
    x402PaymentTx: evidence.x402PaymentTx,
    x402Status: evidence.x402Status,
    x402Reason: evidence.x402Reason,
    // V2 decision provenance — which mission + spec the Deputy judged against.
    ...(mission && campaign.campaignIdHash
      ? {
          commitmentVersion: 2,
          missionIdHash: mission.missionIdHash,
          vaultKind: "campaign_v2" as const,
          missionSpecDigest: recomputeMissionSpecDigest(mission, campaign.campaignIdHash),
        }
      : {}),
  });

  if (inserted) {
    recordEvent({
      campaignId: campaign.id,
      submissionId,
      kind: "decision_recorded",
      detail: encodeDetail(
        `${brief.engine === "llm" ? "Deputy AI" : "Heuristic"} · ${brief.recommendation} · ${short(submission.wallet)}`,
        { cid: opts?.cid },
      ),
    });
  }

  return row ? briefFromRow(row) : brief;
}
