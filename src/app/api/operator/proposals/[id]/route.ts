import { NextResponse, type NextRequest } from "next/server";
import { getFounderAddress } from "@/lib/auth/founder";
import { getLaunch, mandateKey, updateLaunch } from "@/lib/db/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The founder's say over a proposed move, while it is still a proposal. "veto" stops it for good;
 * "now" drops the rest of the window so the agent acts on the next tick. Nothing here spends money
 * or touches a campaign — it only moves the clock the tick reads.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  const launch = getLaunch(id);
  if (!launch || launch.founderKey !== mandateKey(founder)) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (launch.state !== "proposed") {
    return NextResponse.json({ error: `That move is already ${launch.state} — it can't be changed now.` }, { status: 409 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  if (action === "veto") {
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
    updateLaunch(id, { state: "vetoed", vetoReason: reason || "the founder stopped this move" });
    return NextResponse.json({ ok: true, state: "vetoed" });
  }
  if (action === "now") {
    updateLaunch(id, { commitAt: Math.floor(Date.now() / 1000) });
    return NextResponse.json({ ok: true, state: "proposed", commitAt: Math.floor(Date.now() / 1000) });
  }
  return NextResponse.json({ error: "action must be veto or now" }, { status: 400 });
}
