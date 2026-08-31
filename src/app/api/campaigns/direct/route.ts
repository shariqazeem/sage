import { NextResponse, type NextRequest } from "next/server";

import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createDirectCampaign, directCampaignSchema } from "@/lib/launch/direct-campaign";
import { quoteFor } from "@/lib/money/rates";
import { getFounderAddress } from "@/lib/auth/founder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/campaigns/direct — WORK PROOF: create a DIRECT campaign (milestone grant / gig
 * payouts). The operator states the work + evidence contracts + tranche prices; compilation is
 * fully deterministic (no model), and the result is a ready job + an approved plan revision the
 * EXISTING claim → deploy → fund → attach wizard takes over from — the response's `planUrl` is
 * that wizard's front door. Requires a signed-in founder (SIWE), same as inspections.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getFounderAddress();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Connect and sign in to create a campaign." }, { status: 401 });
  }
  const rl = rateLimit("create", clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = directCampaignSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { ok: false, error: `Invalid input at ${first.path.join(".") || "(root)"}: ${first.message}` },
      { status: 400 },
    );
  }

  // Same edge rule as the MCP door: fetch the stamped rate here, refuse rather than guess.
  let quote = null as Awaited<ReturnType<typeof quoteFor>>;
  const code = parsed.data.currency?.trim().toUpperCase();
  if (code && code !== "USD") {
    quote = await quoteFor(code);
    const pricedLocally =
      parsed.data.splitTotalLocal !== undefined ||
      parsed.data.milestones.some((m) => m.rewardLocal !== undefined);
    if (!quote && pricedLocally) {
      return NextResponse.json(
        { error: `No exchange rate for ${code} is available right now — state the amount in USD, or try again shortly.` },
        { status: 503 },
      );
    }
  }
  const result = createDirectCampaign(parsed.data, session, quote);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });

  return NextResponse.json({
    ok: true,
    jobId: result.jobId,
    publicCampaignId: result.publicCampaignId,
    totalBudgetBase: result.totalBudgetBase.toString(),
    planUrl: result.planUrl,
  });
}
