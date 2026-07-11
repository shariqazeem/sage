import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { ensureSandboxCampaign } from "@/lib/db/campaigns";
import { verifySubmission } from "@/lib/deputy/brain";
import { isAutoPayQualifying } from "@/lib/deputy/brain-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NOTE = 600;
const SYNTHETIC_WALLET = `0x${"0".repeat(40)}`;

/**
 * POST /api/redteam/attempt — the public "try to jailbreak the Deputy" pipeline.
 *
 * Runs the REAL frozen brain (server-side injection detector + the LLM + the
 * no-evidence confidence ceiling) against the sandbox campaign, and returns the
 * genuine structured brief. It is HARD-sandboxed:
 *   · it calls `verifySubmission` ONLY — the settle/CAS/vendor path is not in the
 *     call graph, so no money can move and nothing is persisted;
 *   · the sandbox campaign it references also throws at `settleSubmission` and is
 *     excluded from reputation, so payment is structurally unreachable;
 *   · no URL is fetched — evidence stays empty, so evidenceOk=false and the 0.5
 *     ceiling applies (a benign attempt holds on no-evidence grounds, which is
 *     itself the system working).
 * Per-IP + one global daily budget (each attempt runs the real, paid pipeline).
 */
export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  if (!rateLimit("redteam", ip).ok) {
    return NextResponse.json(
      { error: "Too many attempts — give it a few seconds." },
      { status: 429 },
    );
  }
  // One global daily budget so the public box can't become a free LLM proxy.
  if (!rateLimit("redteamDaily", "global").ok) {
    return NextResponse.json({
      over: true,
      message:
        "The daily red-team budget is reached — each attempt runs the real, paid pipeline, so it's capped. Try again tomorrow.",
    });
  }

  let body: { note?: unknown };
  try {
    body = (await req.json()) as { note?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const note = String(body.note ?? "")
    .slice(0, MAX_NOTE)
    .trim();
  if (!note) {
    return NextResponse.json(
      { error: "Enter some text to run through the pipeline." },
      { status: 400 },
    );
  }

  const campaign = ensureSandboxCampaign();
  if (!campaign.sandbox) {
    return NextResponse.json({ error: "Sandbox unavailable." }, { status: 500 });
  }

  // The real judgment. verifySubmission never settles, never persists — it only
  // returns the brief, which is exactly what a real submission would produce.
  const brief = await verifySubmission({
    campaignTitle: campaign.title,
    criteria: campaign.criteria,
    conditionType: campaign.conditionType,
    note,
    wallet: SYNTHETIC_WALLET,
    evidenceUrl: null,
    evidenceText: "",
    evidenceOk: false,
    evidenceFailReason: "no evidence — public jailbreak sandbox",
    contentSha256: null,
  });

  // Structured brief only — never the raw model completion.
  return NextResponse.json({
    ok: true,
    autoPayQualifying: isAutoPayQualifying(brief),
    receipt: brief,
  });
}
