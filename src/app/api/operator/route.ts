import { NextResponse, type NextRequest } from "next/server";
import { getFounderAddress } from "@/lib/auth/founder";
import { getMandate, listLaunches, policyFrom, upsertMandate } from "@/lib/db/operator";
import { allocate, exposureBase, usd } from "@/lib/operator/policy";
import { mandateStateFor } from "@/lib/operator/state";
import { allowedSurfaces } from "@/lib/operator/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A founder's own mandate: what they told the agent it may do, and what it is doing about it. */
export async function GET() {
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const mandate = getMandate(founder);
  if (!mandate) return NextResponse.json({ armed: false, mandate: null, proposals: [], now: Math.floor(Date.now() / 1000) });
  const state = await mandateStateFor(founder);
  const launches = listLaunches(founder, 12);
  const surfaces = state ? allowedSurfaces(state.productUrl, state.observations) : [];
  const verdict = state ? allocate(state, surfaces[0] ?? null) : null;
  return NextResponse.json({
    armed: mandate.enabled === 1,
    now: Math.floor(Date.now() / 1000),
    mandate: { ...mandate, policy: policyFrom(mandate) },
    treasury: state ? { address: state.treasuryAddress, balanceBase: state.balanceBase } : null,
    committedThisWeekBase: state?.committedThisWeekBase ?? 0,
    exposureBase: state ? exposureBase(state.observations) : 0,
    liveCount: state ? state.observations.filter((o) => o.status === "live").length : 0,
    surfaces,
    /** what the mandate would say right now — the honest reason the agent is or is not moving. */
    stance: verdict
      ? verdict.action === "hold"
        ? { moving: false, reason: verdict.reason, fix: fixFor(verdict.reason) }
        : { moving: true, reason: `ready to commit ${usd(verdict.budgetBase)}`, fix: null }
      : null,
    proposals: launches,
  });
}

/**
 * A BLOCKED AGENT SHOULD HAND BACK THE NEXT ACTION, not just the diagnosis.
 *
 * "The treasury is at its reserve floor" is true and useless on its own: the founder has to work out
 * what to do about it. Every constraint the mandate can hit has exactly one thing that clears it, and
 * some have none — a board still being worked just needs time, and saying so is better than inventing
 * a button.
 */
function fixFor(reason: string): { label: string; href: string } | null {
  if (/reserve floor|treasury/i.test(reason)) return { label: "Fund the treasury", href: "/workspace/autopilot" };
  if (/mandate is off/i.test(reason)) return { label: "Let Sage run it", href: "/workspace/autopilot" };
  if (/week's ceiling/i.test(reason)) return { label: "Raise the weekly ceiling", href: "/workspace/autopilot" };
  if (/already running|unclaimed on the board/i.test(reason)) return { label: "See what is running", href: "/dashboard" };
  return null;
}

const int = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
};
const usdToBase = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? Math.round(n * 1e6) : fallback;
};

/** Arm, disarm or retune the mandate. Every ceiling is the founder's, and only theirs. */
export async function POST(req: NextRequest) {
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const current = getMandate(founder);
  const p = current ? policyFrom(current) : null;

  const productUrl = typeof body.productUrl === "string" ? body.productUrl.trim().slice(0, 500) : current?.productUrl ?? null;
  const goal = typeof body.goal === "string" ? body.goal.trim().slice(0, 500) : current?.goal ?? null;
  const instruction = typeof body.instruction === "string" ? body.instruction.trim().slice(0, 500) || null : current?.instruction ?? null;
  const weeklyCapBase = usdToBase(body.weeklyCapUsd, p?.weeklyCapBase ?? 50_000_000);
  const perCampaignCapBase = usdToBase(body.perCampaignCapUsd, p?.perCampaignCapBase ?? 15_000_000);
  const probeBase = usdToBase(body.probeUsd, p?.probeBase ?? 5_000_000);
  const reserveFloorBase = usdToBase(body.reserveFloorUsd, p?.reserveFloorBase ?? 0);

  if (perCampaignCapBase > weeklyCapBase) {
    return NextResponse.json({ error: "A single campaign cannot be allowed more than the whole week." }, { status: 400 });
  }
  if (probeBase > perCampaignCapBase) {
    return NextResponse.json({ error: "The first probe cannot be larger than the per-campaign ceiling." }, { status: 400 });
  }

  const enabled = typeof body.enabled === "boolean" ? (body.enabled ? 1 : 0) : current?.enabled ?? 0;
  if (enabled === 1 && !productUrl) {
    return NextResponse.json({ error: "Name the product first — the agent may only buy work against surfaces you named." }, { status: 400 });
  }

  const saved = upsertMandate(founder, {
    enabled,
    productUrl,
    goal,
    instruction,
    weeklyCapBase,
    perCampaignCapBase,
    probeBase,
    reserveFloorBase,
    maxConcurrent: Math.min(10, Math.max(1, int(body.maxConcurrent, p?.maxConcurrent ?? 3))),
    maxExposureBps: Math.min(10_000, Math.max(500, int(body.maxExposurePct, Math.round((p?.maxExposure ?? 0.6) * 100)) * 100)),
    minSpacingMinutes: Math.max(0, int(body.minSpacingMinutes, p?.minSpacingMinutes ?? 90)),
    stallAfterMinutes: Math.max(60, int(body.stallAfterMinutes, p?.stallAfterMinutes ?? 2880)),
    vetoWindowMinutes: Math.min(1440, Math.max(0, int(body.vetoWindowMinutes, current?.vetoWindowMinutes ?? 20))),
  });
  return NextResponse.json({ ok: true, mandate: { ...saved, policy: policyFrom(saved) } });
}
