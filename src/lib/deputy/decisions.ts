import "server-only";

import { short } from "@/lib/format";
import { encodeDetail } from "@/lib/campaigns/journal";
import {
  deleteDecision,
  getCampaign,
  findArtifactTwin,
  getDecisionBySubmission,
  getMissionByHash,
  getSubmission,
  insertDecision,
  listMissions,
  listSubmissions,
  recomputeMissionSpecDigest,
  recordEvent,
  setSubmissionArtifactSha,
} from "@/lib/db/campaigns";
import {
  identityMismatchSummary,
  missionToIdentity,
  verifyPublicIdentity,
} from "@/lib/campaigns/public-identity";
import type { Decision, Submission } from "@/lib/db/schema";
import { verifyEvidence } from "@/lib/x402/verify-evidence";
import { deriveStoredX402Status } from "@/lib/x402/x402-status";
import { verifySubmission } from "./brain";
import {
  WORKPROOF_VERIFIER_MODEL,
  artifactTwinHash,
  mergeWorkProofEvidence,
  parseWorkProofContract,
  runWorkProof,
} from "./work-proof";
import type { VerificationContract } from "@/lib/verify/contract";
import { walletFreshnessSignal } from "./wallet-signals";
import { fundingClusterSignal } from "./funding-graph";
import type { ObservationShadow } from "./observation-judge";
import type { DecisionBrief, StoredBrief } from "./brain-core";

/**
 * What to tell the judge about WHERE the work lives.
 *
 * A product-testing mission is PERFORMED ON the target surface, so the surface is a genuine
 * acceptance criterion. A created-artifact deliverable is the opposite: the artifact is published
 * somewhere else, and the target surface is only what the work is ABOUT. Stated to the judge as a
 * bare `Target surface:` criterion, it reads as a requirement the artifact can never satisfy — the
 * model then notices the mismatch, is right to flag it, and holds work that passed every real check.
 *
 * Measured live 2026-08-31: a gig whose deterministic contract PASSED (6/7, evidence fetched,
 * marker matched) held at 72% for being published on paste.rs rather than the campaign's own page,
 * which was never a place a deliverable could live. The judge was correct; the brief was not.
 *
 * So for an artifact contract, state the hosting rule the VERIFIER actually enforces. The empty
 * allow-list is "publish anywhere" — see verifyArtifactUrl, where an empty list skips the host
 * check entirely and the marker becomes the whole authorship binding.
 */
export function surfaceCriteria(
  targetSurface: string | null | undefined,
  contract: VerificationContract | null,
): string[] {
  const surface = (targetSurface ?? "").trim();
  if (!surface) return [];
  if (contract?.kind !== "artifact_url") return [`Target surface: ${surface}`];
  const where =
    contract.allowedHosts.length > 0
      ? `The artifact must be published on ${contract.allowedHosts.join(" or ")}.`
      : `The artifact may be published on ANY public host — where it is hosted is NOT a criterion.`;
  return [`${where} Context — what the work is about: ${surface}`];
}
import { hasMissionPlan } from "@/lib/campaigns/vault-kind";

/** Rebuild the full brief (content + provenance) from a stored decision row. */
export function briefFromRow(row: Decision): DecisionBrief {
  return {
    ...row.brief,
    engine: row.engine === "llm" ? "llm" : "heuristic",
    model: row.model,
    // reasonCode + provider were added later; default them for pre-existing rows.
    reasonCode: row.brief.reasonCode ?? "unknown",
    provider: row.brief.provider ?? null,
    // POLICY IDENTITY — the prompt + money-parser version that produced this brief. Persisted in the json
    // blob (no schema change); null for legacy rows predating the stamp → the autopay identity gate holds
    // them for manual review, which is the safe (subtract-only) default.
    promptVersion: row.brief.promptVersion ?? null,
    parserVersion: row.brief.parserVersion ?? null,
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
 * The leak-safe OBSERVATION verdict from a decision row's shadow, or null when the row isn't an
 * observation mission's. Counts + the corpus digest only — the same publishable face as the shadow, safe
 * for any tester- or founder-facing surface. Its presence tells a surface to render the observation panel
 * (Sage judged against its OWN eyes) instead of the url-verifiable brief.
 */
export function observationFromRow(row: Decision | null | undefined): {
  distinctSources: number;
  matchedCount: number;
  keyDistinctSources: number;
  corpusDigest: string;
  barPass: boolean;
  barReasons: string[];
  /** criterion INDEXES with no evidence yet — drives the coaching that names the unmet requirement. */
  unprovenCriteria?: number[];
} | null {
  const s = (row?.observationShadow ?? null) as ObservationShadow | null;
  if (!s) return null;
  return {
    distinctSources: s.distinctSources,
    matchedCount: s.matchedCount,
    keyDistinctSources: s.keyDistinctSources,
    corpusDigest: s.corpusDigest,
    barPass: s.barPass,
    barReasons: s.barReasons,
    ...(s.unprovenCriteria ? { unprovenCriteria: s.unprovenCriteria } : {}),
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
  /** the specific reason (e.g. an identity mismatch); defaults to a missing-mission hold. */
  holdDetail?: string,
): DecisionBrief {
  const detailText =
    holdDetail ?? "no locked mission specification to judge this submission against";
  const brief: StoredBrief = {
    criteria: [],
    fraudSignals: [
      {
        signal: holdDetail ? "public identity unverified" : "mission context unavailable",
        severity: "high",
        reason: detailText,
      },
    ],
    recommendation: "hold",
    reasonCode: "no_evidence",
    confidence: 0,
    summary: `Held: this campaign_v2 submission could not be bound to a verified mission (${detailText}). A human must review the mission configuration.`,
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
      detail: encodeDetail(
        `Heuristic · hold · ${short(submission.wallet)} · ${holdDetail ? "identity mismatch" : "missing mission"}`,
        { cid },
      ),
    });
  }
  return row ? briefFromRow(row) : { ...brief, engine: "heuristic", model: null, evidenceOk: false, contentSha256: null, latencyMs: null, costUsd: null, x402PaymentTx: null, x402Status: "not_required", x402Reason: null };
}

/** The `model` marker on an observation-lane ABSTAIN receipt. The sweep's heuristic-retry must skip
 *  these (there is no LLM upgrade to buy — the abstain IS the correct final receipt), and any reader
 *  can recognize the lane from the row alone. */
export const OBSERVATION_ABSTAIN_MODEL = "observation-abstain";

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
  // A decision is "V2" when it is bound to a mission — true on both rails. Excluding Starknet
  // here recorded its payouts in the pre-mission shape, which the proof page then cannot verify.
  const isV2 = hasMissionPlan(campaign.vaultKind) && !!submission.missionIdHash;
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
    // PUBLIC-IDENTITY INVARIANT (pre-LLM): recompute campaignIdHash / missionIdHash /
    // MissionSpecV1 digest / missionPlanDigest from the PUBLIC campaign + mission ids and
    // compare against every stored value. A persisted hash that merely matches the chain
    // is NOT trusted. Any mismatch HOLDS here — before the model is ever invoked — so a
    // campaign whose public id disagrees with its committed identity can never be paid.
    const identity = verifyPublicIdentity({
      publicCampaignId: campaign.id,
      storedCampaignIdHash: campaign.campaignIdHash,
      storedMissionPlanDigest: campaign.missionPlanDigest,
      missions: listMissions(campaign.id).map(missionToIdentity),
      submission: {
        missionIdHash: submission.missionIdHash,
        missionSpecDigest: submission.missionSpecDigest,
      },
    });
    if (!identity.ok) {
      return holdForMissingMission(
        submission,
        campaign.id,
        submission.missionIdHash!,
        opts?.cid,
        `public identity mismatch: ${identityMismatchSummary(identity)}`,
      );
    }
  }

  // WORK PROOF LANE (docs/work-proof-design.md §C) — a mission carrying an explicit OPERATOR
  // contract is verified deterministically BEFORE any model or class-based routing. The contract
  // outranks the inferred verifiabilityClass: it is authored, validated input, not a prose guess.
  //   definitive fail → an honest heuristic HOLD decision (cached; engine "heuristic" never
  //                     autopays; the sweep never re-buys it; the founder sees the exact reason).
  //   transient fail  → no decision row; the submission stays pending and the next sweep retries.
  //   verified        → the report joins the evidence the UNCHANGED brain judges below — an AND
  //                     term in front of the frozen gate, so payouts only get stricter.
  const workProofContract = parseWorkProofContract(mission?.verificationContract ?? null);
  let workProofReport: string | null = null;
  if (workProofContract) {
    const wp = await runWorkProof(workProofContract, {
      wallet: submission.wallet,
      evidenceUrl: submission.evidenceUrl,
      note: submission.note,
    });
    if (wp.outcome === "transient") return null; // pending — retried on the next sweep
    if (wp.outcome === "definitive") {
      const brief: StoredBrief = {
        criteria: [],
        fraudSignals: [],
        recommendation: "hold",
        reasonCode: "evidence_mismatch",
        confidence: 0,
        summary: `Work-proof verification failed (deterministic check, no model consulted): ${wp.result.publicDetail}`,
        provider: null,
      };
      const { row, inserted } = insertDecision({
        submissionId,
        campaignId: campaign.id,
        engine: "heuristic",
        model: WORKPROOF_VERIFIER_MODEL,
        brief,
        contentSha256: null,
        evidenceOk: false,
        latencyMs: null,
        costUsd: null,
        x402PaymentTx: null,
        x402Status: "not_required",
        x402Reason: null,
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
          detail: encodeDetail(`Work-proof verifier · hold · ${short(submission.wallet)}`, { cid: opts?.cid }),
        });
      }
      return row
        ? briefFromRow(row)
        : { ...brief, engine: "heuristic", model: WORKPROOF_VERIFIER_MODEL, evidenceOk: false, contentSha256: null, latencyMs: null, costUsd: null, x402PaymentTx: null, x402Status: "not_required", x402Reason: null };
    }
    workProofReport = wp.report;
  }

  // OBSERVATION MISSIONS — THE URL-EVIDENCE BRAIN HAS NO JURISDICTION HERE, SO IT ABSTAINS.
  //
  // It was built to fetch a link and verify quotes against fetched content. An observation mission
  // HAS no link to fetch, so it voted `hold / no_evidence / HIGH fraud` on every honest tester — of
  // the first 11 submissions ever, 4 carry a high-severity fraud signal for people who were
  // correctly PAID, including the proven $1 mainnet payout (tx 0x8df776…0069, recorded at
  // confidence 0 with a HIGH signal). The payout gate ignored the brief only because of lane
  // ordering — luck, not design — while the STORED record poisoned every reader: founder surfaces,
  // disputes, audits, anything trained on these rows later.
  //
  // The abstain is a neutral receipt that names the judge with jurisdiction. Nothing is weakened:
  // the observation lane independently re-detects injection on the account (assembleObservationDecision),
  // its own bar + validated-contradiction veto still gate the payout, and wallet freshness (a MEDIUM
  // caution that can never block alone) is still recorded because it is lane-independent. The frozen
  // brain-core is untouched — it simply is not consulted where it cannot judge.
  if (!workProofContract && mission?.verifiabilityClass === "observation-based") {
    const freshness = await walletFreshnessSignal(submission.wallet, campaign.chainId);
    const brief: StoredBrief = {
      criteria: [],
      fraudSignals: freshness ? [freshness] : [],
      recommendation: "review",
      reasonCode: "unknown",
      confidence: 0,
      summary:
        "Observation mission — the URL-evidence brain abstains (no fetchable evidence is expected here). " +
        "The observation judge decides this submission by matching the tester's account against Sage's own " +
        "private browsing corpus; its verdict is the one that governs.",
      provider: null,
    };
    const { row, inserted } = insertDecision({
      submissionId,
      campaignId: campaign.id,
      engine: "heuristic",
      model: OBSERVATION_ABSTAIN_MODEL,
      brief,
      contentSha256: null,
      evidenceOk: false,
      latencyMs: null,
      costUsd: null,
      x402PaymentTx: null,
      x402Status: "not_required",
      x402Reason: null,
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
          `Observation lane · abstain · ${short(submission.wallet)}`,
          { cid: opts?.cid },
        ),
      });
    }
    return row
      ? briefFromRow(row)
      : { ...brief, engine: "heuristic", model: OBSERVATION_ABSTAIN_MODEL, evidenceOk: false, contentSha256: null, latencyMs: null, costUsd: null, x402PaymentTx: null, x402Status: "not_required", x402Reason: null };
  }

  const judgeTitle = mission ? `${mission.title} — ${mission.objective}` : campaign.title;
  // The model judges the MISSION's ordered criteria PLUS its instructions, target
  // surface, and required-evidence as TRUSTED, founder-authored acceptance context —
  // all from the immutable locked mission snapshot, never from the untrusted note.
  // Reward is NEVER included — it is settlement policy, not a measure of evidence quality.
  const judgeCriteria = mission
    ? [
        `Task: ${mission.instructions}`,
        ...surfaceCriteria(mission.targetSurface, workProofContract),
        ...mission.criteria,
        ...mission.evidenceList.map((e) => `Required evidence: ${e}`),
      ]
    : campaign.criteria;

  // RAIL 1 — the Deputy pays for verification when the x402 rail is live; a
  // direct (unpaid) fetch otherwise. `x402PaymentTx` is a real GOAT tx or null.
  const fetched = submission.evidenceUrl
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

  // WORK PROOF (verified) — the deterministic report becomes judgeable evidence, ahead of whatever
  // the link fetch returned. `ok` is honestly true: the evidence (chain state / the artifact) WAS
  // established — by Sage's own check, which the submitter cannot forge. The brain still judges;
  // the frozen gate still gates. An onchain mission whose submitter pasted only a hash (no link)
  // would otherwise carry evidenceOk=false and be confidence-capped for the wrong reason.
  const merged = workProofReport
    ? mergeWorkProofEvidence(workProofReport, { text: fetched.text ?? "", ok: fetched.ok })
    : null;

  // ARTIFACT TWIN CHECK (FC Phase 1) — the marker-swap collusion closer, deterministic and
  // pre-judge. The wallet marker binds an artifact to ITS submitter, but is structurally blind to
  // the same page resubmitted by a second wallet with only the marker changed. So: fingerprint the
  // fetched content with all addresses stripped, persist it, and if another submission in this
  // campaign already carries the fingerprint, HOLD without consulting any model. Content seen
  // before is content seen before — whatever became of the earlier submission.
  if (workProofReport && fetched.ok && (fetched.text ?? "").trim()) {
    const twinSha = artifactTwinHash(fetched.text ?? "");
    setSubmissionArtifactSha(submissionId, twinSha);
    const twin = findArtifactTwin(campaign.id, twinSha, submissionId);
    if (twin) {
      const brief: StoredBrief = {
        criteria: [],
        fraudSignals: [
          {
            signal: "duplicate artifact content",
            severity: "high",
            reason: `The fetched page's content is identical to submission ${twin.id} on this campaign once wallet addresses are removed — the marker-swap shape.`,
          },
        ],
        recommendation: "hold",
        reasonCode: "spam",
        confidence: 0,
        summary:
          "Held without consulting a model: this page's content matches an earlier submission on this campaign with only the wallet marker changed. The operator decides.",
        provider: null,
      };
      const { row, inserted } = insertDecision({
        submissionId,
        campaignId: campaign.id,
        engine: "heuristic",
        model: WORKPROOF_VERIFIER_MODEL,
        brief,
        contentSha256: merged?.contentSha256 ?? null,
        evidenceOk: false,
        latencyMs: null,
        costUsd: null,
        x402PaymentTx: null,
        x402Status: "not_required",
        x402Reason: null,
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
          detail: encodeDetail(`Work-proof verifier · duplicate artifact · ${short(submission.wallet)}`, { cid: opts?.cid }),
        });
      }
      return row
        ? briefFromRow(row)
        : { ...brief, engine: "heuristic", model: WORKPROOF_VERIFIER_MODEL, evidenceOk: false, contentSha256: null, latencyMs: null, costUsd: null, x402PaymentTx: null, x402Status: "not_required", x402Reason: null };
    }
  }

  // PROVENANCE SPLIT (P-WORK finding, 2026-08-27): Sage's own verifier report goes to the judge as
  // a TRUSTED server-authored block (`verifierReport`), and only the FETCHED page stays inside the
  // untrusted markers. Merging both into evidenceText made the judge read "SAGE WORK-PROOF: PASSED"
  // as a submitter self-claim — its rubric then (correctly!) discounted it, and honest gig
  // deliverables held 15-18/18 in the battery. contentSha256 still hashes the MERGED pair, so the
  // stored provenance of what informed the decision is unchanged.
  const evidence = merged
    ? {
        ...fetched,
        text: (fetched.text ?? "").trim() ? (fetched.text as string) : "(no fetched page — Sage's own verification above is the evidence)",
        ok: merged.ok,
        failReason: undefined,
        contentSha256: merged.contentSha256,
      }
    : fetched;

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
    verifierReport: workProofReport,
  });

  // P18 wallet heuristic — a recipient-freshness CAUTION signal recorded on the brief. NEVER high
  // severity, so it can't block a payout alone (the gate holds only on high-severity fraud); it merely
  // combines with the brief's own signals for a reviewer, and a fresh wallet with strong verified
  // evidence still pays. Failure-isolated inside walletFreshnessSignal (an RPC blip yields no signal).
  const freshness = await walletFreshnessSignal(submission.wallet, campaign.chainId);

  // FUNDING-GRAPH SIBLING SIGNAL — the rotation detector freshness and near-dup are both blind to.
  // Measured on prod 2026-08-28: one person funded a daisy chain of four fresh wallets and took all
  // four slots of a mission with four genuinely-written accounts. Medium severity by design (it can
  // never block alone — funding a friend's gas is honest too); it informs the reviewer and the
  // founder's console. Failure-isolated: an explorer blip yields no signal.
  const cluster = await fundingClusterSignal({
    wallet: submission.wallet,
    peerWallets: listSubmissions(campaign.id).map((s) => s.wallet),
    chainId: campaign.chainId ?? 2345,
  }).catch(() => null);

  const fraudSignals = [...brief.fraudSignals, ...(freshness ? [freshness] : []), ...(cluster ? [cluster] : [])];

  const { row, inserted } = insertDecision({
    submissionId,
    campaignId: campaign.id,
    engine: brief.engine,
    model: brief.model,
    brief: {
      criteria: brief.criteria,
      fraudSignals,
      recommendation: brief.recommendation,
      reasonCode: brief.reasonCode,
      confidence: brief.confidence,
      summary: brief.summary,
      provider: brief.provider,
      // POLICY IDENTITY — persist the prompt + money-parser version so the reconstructed brief still
      // carries the exact combination the autopay identity gate must approve.
      promptVersion: brief.promptVersion ?? null,
      parserVersion: brief.parserVersion ?? null,
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
