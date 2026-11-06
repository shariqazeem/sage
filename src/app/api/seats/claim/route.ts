import { NextResponse, type NextRequest } from "next/server";
import { getFounderAddress } from "@/lib/auth/founder";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { claimSeat } from "@/lib/people/seats";
import { currentRound } from "@/lib/programmes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { code } — take a place on a job (or a programme) as the signed-in person. Their wallet joins the
 * job's named list; the judge, the caps and the vault decide everything after, exactly as for anyone.
 */
export async function POST(req: NextRequest) {
  const session = await getFounderAddress();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const rl = rateLimit("seatClaim", clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ error: "Too many tries. Wait a minute." }, { status: 429 });
  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const r = claimSeat(code, session, { currentCampaign: currentRound });
  if (!r.ok) {
    const status = r.reason === "not_found" ? 404 : r.reason === "not_evm" ? 400 : 409;
    return NextResponse.json({ error: r.message, reason: r.reason }, { status });
  }
  return NextResponse.json({ ok: true, already: r.already, campaignId: r.campaignId, seatsLeft: r.seatsLeft });
}
