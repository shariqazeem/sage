import { NextResponse, type NextRequest } from "next/server";

import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createDirectCampaign, directCampaignSchema } from "@/lib/launch/direct-campaign";
import { quoteFor } from "@/lib/money/rates";
import { getFounderAddress } from "@/lib/auth/founder";
import { repeatSchema } from "@/lib/programmes/rounds";
import { createProgramme } from "@/lib/programmes/store";
import { treasuryChainId } from "@/lib/privy/onboarding";

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

  // TIME (6 Nov 2026): "every week, for 8 weeks". The season replays this exact spec each round, so it is
  // priced in dollars once, here: a programme in another currency would move with the rate every week.
  const repeatRaw = (body as { repeat?: unknown }).repeat;
  const repeat = repeatRaw === undefined || repeatRaw === null ? null : repeatSchema.safeParse(repeatRaw);
  if (repeat && !repeat.success) {
    return NextResponse.json({ ok: false, error: "Repeats: every 7, 14 or 30 days, for 2 to 26 rounds." }, { status: 400 });
  }
  if (repeat?.success && parsed.data.currency && parsed.data.currency.trim().toUpperCase() !== "USD") {
    return NextResponse.json({ ok: false, error: "A job that repeats is priced in dollars, so every round pays the same. State the amount in USD." }, { status: 400 });
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

  // Round 1 is this job. The programme stays a draft until it is live (activateRoundOne, on launch).
  const programme = repeat?.success
    ? createProgramme({
        founderWallet: session,
        chainId: treasuryChainId(),
        title: parsed.data.title,
        spec: parsed.data as unknown as Record<string, unknown>,
        roundBudgetBase: result.totalBudgetBase,
        everyDays: repeat.data.everyDays,
        roundsTotal: repeat.data.rounds,
        round1JobId: result.jobId,
      })
    : null;

  return NextResponse.json({
    ok: true,
    jobId: result.jobId,
    publicCampaignId: result.publicCampaignId,
    totalBudgetBase: result.totalBudgetBase.toString(),
    planUrl: result.planUrl,
    programmeId: programme?.id ?? null,
  });
}
