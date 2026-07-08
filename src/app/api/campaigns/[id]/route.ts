import { NextResponse, after, type NextRequest } from "next/server";
import { getAddress } from "viem";
import { getSessionAddress, isSameWallet } from "@/lib/auth/session";
import {
  getCampaign,
  getDecisionBySubmission,
  listCampaignEvents,
  listSubmissions,
  updateCampaignAutonomy,
} from "@/lib/db/campaigns";
import { getVaultState } from "@/lib/deputy/chain";
import { reconcileVendorEvents } from "@/lib/campaigns/reconcile";
import { decodeDetail } from "@/lib/campaigns/journal";
import { assessSubmission } from "@/lib/campaigns/assess";
import { heuristicBrief } from "@/lib/deputy/brain-core";
import { briefFromRow, ensureDecision } from "@/lib/deputy/decisions";
import { validateAutonomy, validateThreshold } from "@/lib/campaigns/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Poster-gated read for the in-app campaign detail surface: the campaign, its
 * submissions, and the live on-chain vault numbers. This is what lets the review
 * queue live inside the app shell (client) while all the truth stays server-side.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const wallet = await getSessionAddress();
  if (!wallet) {
    return NextResponse.json({ error: "Sign in to view this campaign." }, { status: 401 });
  }

  const campaign = getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  if (!isSameWallet(wallet, campaign.posterWallet)) {
    return NextResponse.json(
      { error: "Only the campaign poster can view this." },
      { status: 403 },
    );
  }

  // Cheaply fold any new on-chain vendor events into the journal (range-capped).
  await reconcileVendorEvents(campaign.vaultAddress).catch(() => null);

  // The Deputy's verification receipt, shown to the reviewer before they confirm.
  // Prefer the stored brief (computed at submit time). For an older pending row
  // with no stored decision, show an instant heuristic placeholder now and
  // compute the real (LLM) decision after the response flushes — the badge stays
  // honest ("LLM pending") until the upgrade lands on the next view.
  // Latest autopay outcome per submission (events are newest-first, so the first
  // one we see for a submission is the latest) — drives the queue's Deputy chips.
  const autopayBySub = new Map<
    string,
    { state: "settled" | "held"; reason: string | null; at: number }
  >();
  for (const e of listCampaignEvents(id)) {
    if (!e.submissionId) continue;
    if (e.kind !== "autopay_settled" && e.kind !== "autopay_held") continue;
    if (autopayBySub.has(e.submissionId)) continue;
    // detail is a {"t","cid"} envelope — decode to the human text before parsing,
    // or the raw JSON leaks into the UI.
    const text = decodeDetail(e.detail).text ?? "";
    const parts = text.split(" · ");
    autopayBySub.set(e.submissionId, {
      state: e.kind === "autopay_settled" ? "settled" : "held",
      reason:
        e.kind === "autopay_held"
          ? parts.length > 1
            ? parts.slice(1).join(" · ")
            : text
          : null,
      at: e.createdAt,
    });
  }

  const toCompute: string[] = [];
  const submissions = listSubmissions(id).map((s) => {
    const stored = getDecisionBySubmission(s.id);
    let brief = stored ? briefFromRow(stored) : null;
    if (!brief && s.status === "pending") {
      brief = heuristicBrief(
        assessSubmission({
          criteria: campaign.criteria,
          rewardAmount: campaign.rewardAmount,
          evidenceUrl: s.evidenceUrl,
          note: s.note,
        }),
        { evidenceOk: false, contentSha256: null },
      );
      toCompute.push(s.id);
    }
    return {
      id: s.id,
      wallet: s.wallet,
      evidenceUrl: s.evidenceUrl,
      note: s.note,
      status: s.status,
      payoutTx: s.payoutTx,
      rejectReason: s.rejectReason,
      createdAt: s.createdAt,
      brief,
      autopay: autopayBySub.get(s.id) ?? null,
    };
  });
  if (toCompute.length > 0) {
    after(async () => {
      for (const sid of toCompute) await ensureDecision(sid).catch(() => null);
    });
  }

  const vault = await getVaultState(getAddress(campaign.vaultAddress))
    .then((v) => ({
      budget: v.budget,
      spent: v.spent,
      remaining: v.remaining,
      perTxCap: v.perTxCap,
      velocityCap: v.velocityCap,
      status: v.status,
    }))
    .catch(() => null);

  return NextResponse.json({
    campaign: {
      id: campaign.id,
      title: campaign.title,
      descriptionMd: campaign.descriptionMd,
      criteria: campaign.criteria,
      status: campaign.status,
      rewardAmount: campaign.rewardAmount,
      maxRecipients: campaign.maxRecipients,
      vaultAddress: campaign.vaultAddress,
      autonomy: campaign.autonomy,
      autopilotThreshold: campaign.autopilotThreshold,
      ownerIsSage: campaign.ownerIsSage,
    },
    submissions,
    vault,
  });
}

/**
 * Update a campaign's standing mandate (poster-gated). This is the "confirm
 * policy once" write: flip autopilot on/off and set the confidence threshold.
 * Autonomy changes nothing the vault enforces — it only changes whether the
 * Deputy may act inside the same on-chain limits without a human click.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const wallet = await getSessionAddress();
  if (!wallet) {
    return NextResponse.json({ error: "Sign in to change this campaign." }, { status: 401 });
  }
  const campaign = getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  if (!isSameWallet(wallet, campaign.posterWallet)) {
    return NextResponse.json(
      { error: "Only the campaign poster can change this." },
      { status: 403 },
    );
  }

  let body: { autonomy?: unknown; autopilotThreshold?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const autonomy = validateAutonomy(body.autonomy);
  const autopilotThreshold = validateThreshold(body.autopilotThreshold);
  updateCampaignAutonomy(id, { autonomy, autopilotThreshold });

  return NextResponse.json({ ok: true, autonomy, autopilotThreshold });
}
