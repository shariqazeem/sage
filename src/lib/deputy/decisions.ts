import "server-only";

import { short } from "@/lib/format";
import { encodeDetail } from "@/lib/campaigns/journal";
import {
  deleteDecision,
  getCampaign,
  getDecisionBySubmission,
  getSubmission,
  insertDecision,
  recordEvent,
} from "@/lib/db/campaigns";
import type { Decision } from "@/lib/db/schema";
import { verifyEvidence } from "@/lib/x402/verify-evidence";
import { deriveStoredX402Status } from "@/lib/x402/x402-status";
import { verifySubmission } from "./brain";
import type { DecisionBrief } from "./brain-core";

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
    campaignTitle: campaign.title,
    criteria: campaign.criteria,
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
