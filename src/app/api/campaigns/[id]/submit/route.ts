import { NextResponse, after, type NextRequest } from "next/server";
import { getSessionAddress } from "@/lib/auth/session";
import { getStarknetSessionAddress } from "@/lib/auth/starknet-session";
import { runDeputyOnSubmission } from "@/lib/deputy/pipeline";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { MAX_ACCOUNT_CHARS } from "@/lib/campaigns/evidence-answers";
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
  listSlotClaimants,
  countRecentSubmissionsByWallet,
  listSubmissions,
  recordEvent,
} from "@/lib/db/campaigns";
import { computeEvidenceDigest, verifyEvidenceClaim, type EvidenceClaim } from "@/lib/campaigns/evidence-claim";
import { verifyStarknetEvidenceClaim } from "@/lib/campaigns/starknet-evidence-claim";
import { readClaimSignature } from "@/lib/campaigns/claim-signature";
import { isSanctionedWallet, SANCTIONS_LIST_LABEL } from "@/lib/deputy/sanctions";
import { observationFromRow } from "@/lib/deputy/decisions";
import { OBS_MAX_ATTEMPTS } from "@/lib/deputy/observation-verify";
import { short } from "@/lib/format";
import { missionSlotStatus, slotsHeldMessage } from "@/lib/campaigns/slot-reservation";
import { nowSeconds } from "@/lib/db/keys";
import { hasMissionPlan } from "@/lib/campaigns/vault-kind";
import { sameChainAddress } from "@/lib/campaigns/chain-address";

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

  // The campaign is loaded BEFORE authentication because it decides which wallet counts. A
  // Starknet-settled campaign pays a Starknet address, so an EVM session cannot establish the
  // payout address for it and vice versa. This is a pure read with no side effects, so nothing
  // downstream changes order.
  const campaign = getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  // THE INVARIANT, ON EITHER RAIL: the payout address is the one that proved control of itself by
  // signing in — never one supplied with the submission. Without that, anyone could do the work
  // and direct the money elsewhere.
  const onStarknet = campaign.settlementRail === "starknet";
  const wallet = onStarknet ? await getStarknetSessionAddress() : await getSessionAddress();
  if (!wallet) {
    return NextResponse.json(
      {
        error: onStarknet
          ? "Connect and sign in with a Starknet wallet to submit — that is where you'll be paid."
          : "Connect and sign in with your wallet to submit.",
      },
      { status: 401 },
    );
  }
  // SANCTIONS SCREEN — refused at the door, before any work is accepted; the pipeline and manual
  // release re-check independently. Vendored OFAC SDN snapshot, exact address match only.
  //
  // HONEST LIMITATION: the SDN snapshot lists EVM-format addresses, so a Starknet address will
  // never match it. This is not screening the Starknet rail, and it must not be described as
  // though it were.
  if (isSanctionedWallet(wallet)) {
    return NextResponse.json(
      { error: `This wallet appears on the ${SANCTIONS_LIST_LABEL} and cannot participate.` },
      { status: 403 },
    );
  }
  const rl = rateLimit("submit", clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  if (campaign.status !== "live") {
    return NextResponse.json({ error: "This campaign isn't accepting submissions." }, { status: 409 });
  }
  // WORK PROOF — recipient allowlist (direct grant/gig campaigns). An application-level gate,
  // stated honestly as such: the vault still enforces caps/budget/replay for whoever gets through.
  if (Array.isArray(campaign.allowlist) && campaign.allowlist.length > 0) {
    // Chain-aware membership: a felt's spelling varies by padding, and a raw match would refuse
    // an invited recipient from their own grant.
    if (!campaign.allowlist.some((a) => sameChainAddress(a, wallet))) {
      return NextResponse.json(
        { error: "This campaign pays a named recipient list, and your wallet isn't on it. Contact the operator." },
        { status: 403 },
      );
    }
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
  // 500 was sized for ONE free-text box. The mission now asks up to MAX_EVIDENCE_PROMPTS questions
  // and the answers are composed into this single note, so a tester who answers each one properly
  // blows the old cap — and detail is exactly what the observation bar requires to pay them. A limit
  // that rejects the accounts most likely to clear is a limit fighting its own product.
  const note = validateOptionalText(body.note, "Note", MAX_ACCOUNT_CHARS);
  if (!note.ok) return NextResponse.json({ error: note.error }, { status: 400 });

  let missionTargetSurface: string | null = null;
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

  // MISSION-SCOPED SUBMIT. Gated on `campaign_v2` alone, a Starknet campaign fell to the
  // pre-mission branch below: no mission binding, so a tester's work could not be matched to the
  // terms the vault will actually pay for.
  if (hasMissionPlan(campaign.vaultKind)) {
    // ── V2: mission-scoped, signature-bound ──────────────────────────────────
    if (typeof body.missionKey !== "string") {
      return NextResponse.json({ error: "Choose a mission to submit to." }, { status: 400 });
    }
    const mission = getMissionByKey(id, body.missionKey);
    missionTargetSurface = mission?.targetSurface ?? null;
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
    //
    // A LIVE INVITATION HOLDS ITS PLACE. Sage tells a tester whose account fell short "refine this
    // and resubmit"; until 2026-08-14 that promise was worthless, because slots were only consumed
    // on PAYMENT and anyone could take the last one while they were rewriting. Measured on the first
    // funded campaign: a tester submitted to the wrong mission, was invited back, and the mission
    // filled while they fixed it — work done twice, paid nothing. The cost of the fix falls on
    // someone who has not started yet and is told to come back, which is the right person to pay it.
    if (!reviseTargetId) {
      const slots = missionSlotStatus(
        listSlotClaimants(mission.missionIdHash),
        mission.maxCompletions,
        nowSeconds(),
      );
      if (slots.open <= 0) {
        return NextResponse.json(
          {
            error:
              slots.reserved > 0
                ? slotsHeldMessage(slots, nowSeconds())
                : "This mission has reached its completion limit.",
          },
          { status: 409 },
        );
      }
    }
    const claim = body.claim;
    const signature = body.signature;
    // An EVM signature is one hex string; a Starknet one is an array of felts, because the account
    // contract — not a recovery — decides whether it is valid.
    const sig = readClaimSignature(onStarknet ? "starknet" : "evm", signature);
    if (!claim || !sig) {
      /**
       * SAY WHAT ARRIVED. This message reads as "you did not sign", and the first time it fired
       * the tester HAD signed — the reader required hex and the wallet returned decimal felts.
       * Without this, a wallet whose spelling we do not accept is indistinguishable from a wallet
       * that refused, and the only way to tell was to guess.
       *
       * Shapes and lengths, never the values: a signature is public once submitted, but a log is
       * the wrong place to accumulate them.
       */
      console.warn(
        "[submit] rejected commitment · rail=%s claim=%s signature=%s",
        onStarknet ? "starknet" : "evm",
        claim ? "present" : "missing",
        Array.isArray(signature)
          ? `array(${signature.length})[${signature
              .slice(0, 4)
              .map((p) => `${typeof p}:${typeof p === "string" ? `${p.length}ch${p.startsWith("0x") ? ":0x" : ""}` : ""}`)
              .join(",")}]`
          : typeof signature,
      );
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
    /**
     * THE SAME GUARANTEE ON EITHER RAIL: this wallet, this evidence, this mission.
     *
     * An EVM claim is an EIP-712 signature recovered to an address. A Starknet account is a
     * CONTRACT — there is nothing to recover to, so the account itself decides via
     * `is_valid_signature`, exactly as founder sign-in already does.
     *
     * This used to answer 409 "not available on this rail yet", which was the honest call while
     * the SNIP-12 side did not exist. It also meant every Starknet campaign was unsubmittable:
     * every V2 campaign is mission-bound, so a funded Cairo vault that WOULD pay could never
     * receive a submission to pay for.
     */
    const evidenceDigest = computeEvidenceDigest({ evidenceUrl: evidenceUrl ?? "", note: note.value ?? "" });
    const now = Math.floor(Date.now() / 1000);
    const verdict =
      sig.rail === "starknet"
        ? await verifyStarknetEvidenceClaim(claim, sig.signature, {
            expectedWallet: wallet,
            now,
            evidenceDigest,
          })
        : await verifyEvidenceClaim(claim, sig.signature, {
            expectedWallet: wallet as `0x${string}`,
            chainId: campaign.chainId ?? 59902,
            now,
            evidenceDigest,
          });
    if (!verdict.ok) {
      // An undeployed account is the one failure whose remedy is not "sign again": the wallet has
      // never sent a transaction, so there is no contract to ask.
      if (verdict.reason === "undeployed") {
        return NextResponse.json(
          {
            error:
              "That wallet has no account contract on Starknet yet — send one transaction from it (any amount) and try again.",
          },
          { status: 400 },
        );
      }
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
      // A link that IS the mission's target distinguishes nobody — every honest tester on a
      // fixed-target mission lands on the same page, and the second was refused for agreeing
      // with the first.
      missionTargetSurface: missionTargetSurface ?? null,
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
