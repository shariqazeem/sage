import { NextResponse, type NextRequest } from "next/server";

import { getFounderAddress } from "@/lib/auth/founder";
import { flagReason, REASON_MAX, REASON_MIN } from "@/lib/campaigns/builder-flag";
import { ownsCampaign, rejectSubmission, releaseSubmission } from "@/lib/campaigns/review-actions";
import { hasMissionPlan } from "@/lib/campaigns/vault-kind";
import { getCampaign, getSubmission } from "@/lib/db/campaigns";
import { heldForBuilder } from "@/lib/test-page/tracking";

// A release runs the real settle path, so: never cached, Node runtime, room for the transaction.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/t/<campaign id>/answers/<submission id>: the builder decides an answer Sage held for them,
 * from the test's own page (27 Nov 2026). Body `{ decision: "pay" }` or `{ decision: "decline", reason }`.
 *
 * NO NEW SETTLEMENT LOGIC. "pay" is `releaseSubmission` and "decline" is `rejectSubmission`
 * (review-actions.ts), the same two functions the chat review and the operator's script call: the
 * sanctions screen, the approval, the journal and `settleByRail` are theirs. No amount is passed anywhere;
 * the vault derives it and enforces its caps and replay rules. The operator's key signs the payout on the
 * server, so the builder's browser signs nothing.
 *
 * Narrower than the older review door on purpose: only the test's owner, and only an answer that is
 * waiting for them (`heldForBuilder`): one Sage has read, that the tester is not still adding to.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; sid: string }> }) {
  const { id, sid } = await ctx.params;
  const me = await getFounderAddress();
  if (!me) return NextResponse.json({ error: "Sign in to decide this answer." }, { status: 401 });
  const campaign = getCampaign(id);
  // a stranger learns nothing here: not the test, not the answer
  if (!campaign || !hasMissionPlan(campaign.vaultKind) || !ownsCampaign(campaign, me)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const submission = getSubmission(sid);
  if (!submission || submission.campaignId !== id) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (submission.status !== "pending") {
    return NextResponse.json({ error: "This answer was already decided. Open the test again to see where it stands." }, { status: 409 });
  }
  if (!heldForBuilder(campaign).has(sid)) {
    return NextResponse.json({ error: "Sage is still checking this answer. It will ask you if it needs you." }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as { decision?: unknown; reason?: unknown };

  if (body.decision === "decline") {
    const reason = flagReason(body.reason);
    if (!reason) {
      return NextResponse.json({ error: `Say in a few words why it isn't paid (${REASON_MIN} to ${REASON_MAX} characters). The tester reads it.` }, { status: 400 });
    }
    // "The builder said:" is the mark the test page reads to show the builder's words to the tester as written
    const r = rejectSubmission(id, sid, `The builder said: ${reason}`);
    if (!r.ok) return NextResponse.json({ error: "That answer just changed. Open the test again to see where it stands." }, { status: 409 });
    return NextResponse.json({ ok: true, status: "declined" });
  }

  if (body.decision !== "pay") return NextResponse.json({ error: "decision must be 'pay' or 'decline'." }, { status: 400 });

  let result;
  try {
    result = await releaseSubmission(id, sid);
  } catch (err) {
    // the answer is approved and the payment did not go through: the sweep settles approved answers, so it is tried again
    console.error("[t/answers] settle failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: true, status: "approved", settled: false, receipt: null, note: "You approved it. The payment did not go through just now; Sage tries it again within a few minutes." });
  }
  if (!result.ok) {
    const refused = result.error?.startsWith("refused:");
    return NextResponse.json(
      { error: refused ? "Sage cannot pay this wallet: it is on a sanctions list. Nothing was paid." : "That answer just changed. Open the test again to see where it stands." },
      { status: refused ? 403 : 409 },
    );
  }
  return NextResponse.json({
    ok: true,
    status: result.settled ? "paid" : "approved",
    settled: result.settled === true,
    receipt: result.settled && result.txHash ? `/proof/${result.txHash}` : null,
    // the vault's own words when it did not pay (a full mission, a wallet already paid its limit)
    note: result.settled ? null : (result.reason ?? "You approved it. Sage pays it within a few minutes."),
  });
}
