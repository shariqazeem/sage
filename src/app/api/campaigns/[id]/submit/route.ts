import { NextResponse, after, type NextRequest } from "next/server";
import { getSessionAddress } from "@/lib/auth/session";
import { runDeputyOnSubmission } from "@/lib/deputy/pipeline";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  validateEvidenceUrl,
  validateOptionalText,
} from "@/lib/campaigns/validate";
import {
  createSubmission,
  getCampaign,
  getDecisionBySubmission,
  getMissionByKey,
  getWalletMissionSubmission,
  reviseSubmission,
  countPaidForMission,
  countRecentSubmissionsByWallet,
  listSubmissions,
  recordEvent,
} from "@/lib/db/campaigns";
import { computeEvidenceDigest, verifyEvidenceClaim, type EvidenceClaim } from "@/lib/campaigns/evidence-claim";
import { observationFromRow } from "@/lib/deputy/decisions";
import { OBS_MAX_ATTEMPTS } from "@/lib/deputy/observation-verify";
import { short } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-wallet-per-campaign daily submission cap (P18). Env-overridable; honest limit, never silent. */
const SUBMIT_DAILY_LIMIT = Number(process.env.SUBMIT_DAILY_LIMIT) || 3;
const ONE_DAY_SECONDS = 24 * 60 * 60;

const SUBMIT_ERROR: Record<string, string> = {
  duplicate_wallet: "You've already submitted to this campaign.",
  duplicate_mission: "You've already submitted to this mission.",
  duplicate_evidence: "That evidence link was already submitted.",
  unknown: "Could not record your submission.",
};

/**
 * A participant submits their entry to a campaign. The submitter is the authenticated
 * wallet (so a payout can only ever reach a wallet that proved control — never a
 * client-supplied recipient). For a V2 campaign the submission is bound to a specific
 * mission AND to a tester EIP-712 evidence-claim signature: the signature must recover to
 * the session wallet and commit to the exact evidence + mission, so evidence cannot be
 * swapped after signing and a signature cannot be replayed onto another mission. The route
 * never calls payout — it hands the durable submission to the real pipeline via `after`.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const wallet = await getSessionAddress();
  if (!wallet) {
    return NextResponse.json({ error: "Connect and sign in with your wallet to submit." }, { status: 401 });
  }
  const rl = rateLimit("submit", clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const campaign = getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  if (campaign.status !== "live") {
    return NextResponse.json({ error: "This campaign isn't accepting submissions." }, { status: 409 });
  }

  let body: { evidence?: unknown; note?: unknown; missionKey?: unknown; claim?: EvidenceClaim; signature?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Evidence is optional, but if present it must pass SSRF validation.
  let evidenceUrl: string | null = null;
  if (body.evidence != null && body.evidence !== "") {
    const ev = validateEvidenceUrl(body.evidence);
    if (!ev.ok) return NextResponse.json({ error: ev.error }, { status: 400 });
    evidenceUrl = ev.value;
  }
  const note = validateOptionalText(body.note, "Note", 500);
  if (!note.ok) return NextResponse.json({ error: note.error }, { status: 400 });

  let missionIdHash: string | null = null;
  let missionSpecDigest: string | null = null;
  // P20 retry-while-held: when set, this submit REVISES an existing held observation submission in place
  // (re-judge, attempt++) instead of creating a new row — so a genuine tester who was held for thin detail
  // gets a coached second/third try, never a dead end.
  let reviseTargetId: string | null = null;
  // For an OBSERVATION mission the evidence URL is the shared product page (every tester submits it), not
  // a unique proof. Storing it would trip the url-lane replay index (sub_evidence_unq) and block the
  // SECOND observation tester. We exempt it by storing NULL (SQLite treats NULLs as distinct), leaving the
  // url-verifiable replay guard byte-identical — url-lane rows still store their real URL and collide.
  let evidenceUrlToStore: string | null = evidenceUrl;

  if (campaign.vaultKind === "campaign_v2") {
    // ── V2: mission-scoped, signature-bound ──────────────────────────────────
    if (typeof body.missionKey !== "string") {
      return NextResponse.json({ error: "Choose a mission to submit to." }, { status: 400 });
    }
    const mission = getMissionByKey(id, body.missionKey);
    if (!mission || mission.status !== "active") {
      return NextResponse.json({ error: "That mission isn't open for submissions." }, { status: 409 });
    }
    // P20 retry detection: an observation mission the wallet ALREADY has a non-final submission to is a
    // REVISION (re-judge the held account), not a new entry — up to OBS_MAX_ATTEMPTS. Evidence is also
    // exempted from the url-lane replay index (the account is the evidence, not the shared product URL).
    if (mission.verifiabilityClass === "observation-based") {
      evidenceUrlToStore = null;
      const existing = getWalletMissionSubmission(mission.missionIdHash, wallet);
      if (existing && existing.status !== "paid" && existing.status !== "rejected" && existing.status !== "blocked") {
        // Only a below-bar, non-fraud hold may be revised (mirrors the pipeline). A bar-PASSED hold is
        // awaiting the founder's payout — a resubmit would delete the passing verdict; a fraud hold is
        // final (attacks don't get retries). Both are already with the founder, so refuse the revision.
        const prior = observationFromRow(getDecisionBySubmission(existing.id));
        if (prior && (prior.barPass || prior.barReasons.includes("high_fraud"))) {
          return NextResponse.json({ error: "This submission is already with the founder for review — it can't be revised." }, { status: 409 });
        }
        if ((existing.attempt ?? 1) >= OBS_MAX_ATTEMPTS) {
          return NextResponse.json({ error: `You've used all ${OBS_MAX_ATTEMPTS} attempts on this mission — it's now with the founder for review.` }, { status: 409 });
        }
        reviseTargetId = existing.id;
      }
    }
    // Completion cap gates only a NEW entry — a retry occupies its existing (unpaid, held) slot.
    if (!reviseTargetId && countPaidForMission(mission.missionIdHash) >= mission.maxCompletions) {
      return NextResponse.json({ error: "This mission has reached its completion limit." }, { status: 409 });
    }
    const claim = body.claim;
    const signature = body.signature;
    if (!claim || typeof signature !== "string") {
      return NextResponse.json({ error: "A signed evidence commitment is required." }, { status: 400 });
    }
    // The signed claim must bind THIS campaign + mission (not just any).
    const bindsRight =
      claim.publicCampaignId === id &&
      (campaign.campaignIdHash ?? "").toLowerCase() === claim.campaignIdHash?.toLowerCase() &&
      claim.missionKey === mission.missionKey &&
      claim.missionIdHash?.toLowerCase() === mission.missionIdHash.toLowerCase() &&
      (mission.specDigest ?? "").toLowerCase() === claim.missionSpecDigest?.toLowerCase();
    if (!bindsRight) {
      return NextResponse.json({ error: "This signature doesn't match the mission — reload and sign again." }, { status: 400 });
    }
    const evidenceDigest = computeEvidenceDigest({ evidenceUrl: evidenceUrl ?? "", note: note.value ?? "" });
    const verdict = await verifyEvidenceClaim(claim, signature as `0x${string}`, {
      expectedWallet: wallet,
      chainId: campaign.chainId ?? 59902,
      now: Math.floor(Date.now() / 1000),
      evidenceDigest,
    });
    if (!verdict.ok) {
      return NextResponse.json({ error: `Signature rejected (${verdict.reason}).` }, { status: 400 });
    }
    missionIdHash = mission.missionIdHash;
    missionSpecDigest = mission.specDigest ?? null;
  } else {
    // ── V1 (legacy): campaign-scoped, session-authed ─────────────────────────
    if (campaign.maxRecipients > 0) {
      const paid = listSubmissions(id).filter((s) => s.status === "paid").length;
      if (paid >= campaign.maxRecipients) {
        return NextResponse.json({ error: "This campaign has reached its recipient limit." }, { status: 409 });
      }
    }
  }

  // Per-wallet daily submission cap (P18) — anti-spam, DB-backed, honest 429. A RETRY revises an existing
  // held submission (doesn't add a row), so it's exempt — a held tester improving their account isn't spam.
  if (!reviseTargetId) {
    const sinceUnix = Math.floor(Date.now() / 1000) - ONE_DAY_SECONDS;
    if (countRecentSubmissionsByWallet(id, wallet, sinceUnix) >= SUBMIT_DAILY_LIMIT) {
      return NextResponse.json(
        { error: `You've reached this campaign's daily submission limit (${SUBMIT_DAILY_LIMIT}/day per wallet). Please try again tomorrow.` },
        { status: 429 },
      );
    }
  }

  let submissionId: string;
  let status: string;
  if (reviseTargetId) {
    // P20 retry: revise IN PLACE (attempt++, re-judge fresh). One row, one payout per wallet, unchanged.
    const revised = reviseSubmission(reviseTargetId, { evidenceUrl: evidenceUrlToStore, note: note.value || null });
    if (!revised) return NextResponse.json({ error: SUBMIT_ERROR.unknown }, { status: 409 });
    submissionId = revised.id;
    status = revised.status;
    recordEvent({ campaignId: id, submissionId, kind: "submission_received", detail: `${short(wallet)} · revised (attempt ${revised.attempt}/${OBS_MAX_ATTEMPTS})` });
  } else {
    const result = createSubmission({
      campaignId: id,
      wallet,
      evidenceUrl: evidenceUrlToStore,
      note: note.value || null,
      missionIdHash,
      missionSpecDigest,
    });
    if (!result.ok) {
      return NextResponse.json({ error: SUBMIT_ERROR[result.error] ?? SUBMIT_ERROR.unknown }, { status: 409 });
    }
    submissionId = result.submission.id;
    status = result.submission.status;
    recordEvent({ campaignId: id, submissionId, kind: "submission_received", detail: short(wallet) });
  }

  // Run the Deputy AFTER the response flushes — verify (decision) and, on autopilot, settle.
  // The submission is already durable, so a slow brain/chain call never delays or fails the
  // submit. The pipeline is the ONE payout path; this route never calls requestPayout.
  after(async () => {
    try {
      await runDeputyOnSubmission(submissionId);
    } catch (err) {
      console.error("[submit] deputy pipeline failed:", err);
    }
  });

  return NextResponse.json({ ok: true, submissionId, status, revised: !!reviseTargetId });
}
