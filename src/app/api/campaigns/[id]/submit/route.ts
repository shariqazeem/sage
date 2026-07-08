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
  listSubmissions,
  recordEvent,
} from "@/lib/db/campaigns";
import { short } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUBMIT_ERROR: Record<string, string> = {
  duplicate_wallet: "You've already submitted to this campaign.",
  duplicate_evidence: "That evidence link was already submitted.",
  unknown: "Could not record your submission.",
};

/**
 * A participant submits their entry to a campaign. The submitter is the
 * authenticated wallet (so a payout can only ever reach a wallet that proved
 * control). Evidence is SSRF-validated; the wallet+evidence unique indexes make
 * dedupe a DB guarantee, surfaced here as a friendly 409.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const wallet = await getSessionAddress();
  if (!wallet) {
    return NextResponse.json(
      { error: "Connect and sign in with your wallet to submit." },
      { status: 401 },
    );
  }

  const rl = rateLimit("submit", clientIp(req.headers));
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const campaign = getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  if (campaign.status !== "live") {
    return NextResponse.json(
      { error: "This campaign isn't accepting submissions." },
      { status: 409 },
    );
  }

  let body: { evidence?: unknown; note?: unknown };
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

  // Respect the recipient cap: once enough have been paid, the campaign is full.
  if (campaign.maxRecipients > 0) {
    const paid = listSubmissions(id).filter((s) => s.status === "paid").length;
    if (paid >= campaign.maxRecipients) {
      return NextResponse.json(
        { error: "This campaign has reached its recipient limit." },
        { status: 409 },
      );
    }
  }

  const result = createSubmission({
    campaignId: id,
    wallet,
    evidenceUrl,
    note: note.value || null,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: SUBMIT_ERROR[result.error] ?? SUBMIT_ERROR.unknown },
      { status: 409 },
    );
  }

  recordEvent({
    campaignId: id,
    submissionId: result.submission.id,
    kind: "submission_received",
    detail: short(wallet),
  });

  // Run the Deputy AFTER the response flushes — verify (compute the decision) and,
  // if the campaign is on autopilot and it clears the gate + policy, auto-settle.
  // The submission row is already committed, so a slow/failing brain or chain call
  // can never fail or delay the participant's submit. Idempotent + best-effort.
  const submissionId = result.submission.id;
  after(async () => {
    try {
      await runDeputyOnSubmission(submissionId);
    } catch (err) {
      console.error("[submit] deputy pipeline failed:", err);
    }
  });

  return NextResponse.json({
    ok: true,
    submissionId,
    status: result.submission.status,
  });
}
