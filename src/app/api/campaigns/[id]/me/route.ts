import { NextResponse, type NextRequest } from "next/server";
import { getSessionAddress } from "@/lib/auth/session";
import {
  getCampaign,
  getDecisionBySubmission,
  getWalletSubmission,
  getWalletMissionSubmission,
  listCampaignEvents,
} from "@/lib/db/campaigns";
import { briefFromRow, observationFromRow } from "@/lib/deputy/decisions";
import { OBS_MAX_ATTEMPTS } from "@/lib/deputy/observation-verify";
import { observationCoaching } from "@/lib/deputy/reason-copy";
import { decodeDetail } from "@/lib/campaigns/journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The latest autonomous outcome for one submission (events are newest-first). */
function ownAutopay(
  campaignId: string,
  submissionId: string,
): { state: "settled" | "held"; reason: string | null } | null {
  for (const e of listCampaignEvents(campaignId)) {
    if (e.submissionId !== submissionId) continue;
    if (e.kind !== "autopay_settled" && e.kind !== "autopay_held") continue;
    const text = decodeDetail(e.detail).text ?? "";
    const parts = text.split(" · ");
    return {
      state: e.kind === "autopay_settled" ? "settled" : "held",
      reason:
        e.kind === "autopay_held"
          ? parts.length > 1
            ? parts.slice(1).join(" · ")
            : text
          : null,
    };
  }
  return null;
}

/**
 * The authenticated wallet's OWN submission to this campaign, or null — now with
 * its decision brief + autonomous outcome so the worker watches the Deputy verify
 * and pay their own entry live. Own-scope ONLY: no other submitter's note, wallet,
 * or brief is ever exposed here.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const wallet = await getSessionAddress();
  if (!wallet) return NextResponse.json({ submission: null, authed: false });
  if (!getCampaign(id)) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  // V2: a wallet's submission is scoped to a mission (?mission=<missionIdHash>). Without it,
  // the campaign-level (V1) submission is returned — backward compatible.
  const mission = req.nextUrl.searchParams.get("mission");
  const sub = mission ? getWalletMissionSubmission(mission, wallet) : getWalletSubmission(id, wallet);
  if (!sub) return NextResponse.json({ authed: true, submission: null });

  const stored = getDecisionBySubmission(sub.id);
  // For an OBSERVATION mission Sage judges against its own private eyes — never the url-verifiable brain.
  // The observation verdict (present only for observation missions) tells the board which panel to render.
  const observation = observationFromRow(stored);
  const autopay = ownAutopay(id, sub.id);

  // P20 retry-while-held: a thin-but-genuine observation hold can be revised in place (≤3 attempts). The
  // board reads `retry` to offer a resubmit affordance + leak-safe coaching. Counts only — never corpus text.
  // Mirrors the pipeline's retryable rule EXACTLY: only a below-bar, non-fraud hold with attempts left is
  // retryable. A bar-PASSED hold (ready to pay, founder approving) and a fraud hold are NOT — no button.
  const attempt = sub.attempt ?? 1;
  const attemptsLeft = Math.max(0, OBS_MAX_ATTEMPTS - attempt);
  const heldNow = autopay?.state === "held" && sub.status !== "paid";
  const fraudFlagged = !!observation?.barReasons.includes("high_fraud");
  const barPassed = !!observation?.barPass;
  const retryable = !!observation && heldNow && !barPassed && !fraudFlagged && attemptsLeft > 0;
  const retry =
    observation && heldNow
      ? {
          attempt,
          maxAttempts: OBS_MAX_ATTEMPTS,
          attemptsLeft,
          retryable,
          coaching: retryable
            ? observationCoaching(observation.distinctSources, observation.keyDistinctSources, attemptsLeft)
            : barPassed
              ? "Sage verified your work — the founder is releasing your reward."
              : fraudFlagged
                ? "This submission was flagged for review — the founder is taking a look."
                : `Sage couldn't auto-clear this after ${OBS_MAX_ATTEMPTS} attempts — the founder is reviewing it now.`,
        }
      : null;

  return NextResponse.json({
    authed: true,
    submission: {
      id: sub.id,
      status: sub.status,
      payoutTx: sub.payoutTx,
      evidenceUrl: sub.evidenceUrl,
      // url-verifiable missions carry the brain brief; observation missions carry the observation verdict.
      brief: observation ? null : stored ? briefFromRow(stored) : null,
      observation,
      retry,
      autopay,
    },
  });
}
