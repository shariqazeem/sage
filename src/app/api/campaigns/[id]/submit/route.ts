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
  getMissionByKey,
  countPaidForMission,
  listSubmissions,
  recordEvent,
} from "@/lib/db/campaigns";
import { computeEvidenceDigest, verifyEvidenceClaim, type EvidenceClaim } from "@/lib/campaigns/evidence-claim";
import { short } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  if (campaign.vaultKind === "campaign_v2") {
    // ── V2: mission-scoped, signature-bound ──────────────────────────────────
    if (typeof body.missionKey !== "string") {
      return NextResponse.json({ error: "Choose a mission to submit to." }, { status: 400 });
    }
    const mission = getMissionByKey(id, body.missionKey);
    if (!mission || mission.status !== "active") {
      return NextResponse.json({ error: "That mission isn't open for submissions." }, { status: 409 });
    }
    if (countPaidForMission(mission.missionIdHash) >= mission.maxCompletions) {
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

  const result = createSubmission({
    campaignId: id,
    wallet,
    evidenceUrl,
    note: note.value || null,
    missionIdHash,
    missionSpecDigest,
  });
  if (!result.ok) {
    return NextResponse.json({ error: SUBMIT_ERROR[result.error] ?? SUBMIT_ERROR.unknown }, { status: 409 });
  }

  recordEvent({
    campaignId: id,
    submissionId: result.submission.id,
    kind: "submission_received",
    detail: short(wallet),
  });

  // Run the Deputy AFTER the response flushes — verify (decision) and, on autopilot, settle.
  // The submission is already durable, so a slow brain/chain call never delays or fails the
  // submit. The pipeline is the ONE payout path; this route never calls requestPayout.
  const submissionId = result.submission.id;
  after(async () => {
    try {
      await runDeputyOnSubmission(submissionId);
    } catch (err) {
      console.error("[submit] deputy pipeline failed:", err);
    }
  });

  return NextResponse.json({ ok: true, submissionId, status: result.submission.status });
}
