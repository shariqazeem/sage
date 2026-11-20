import { NextResponse, type NextRequest } from "next/server";
import { getFounderAddress } from "@/lib/auth/founder";
import { prepareOwnWallet } from "@/lib/own-wallet/server";
import { ownWalletStatus } from "@/lib/own-wallet/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { approve?, expectedRevision? } — what the session's OWN wallet signs to launch this plan on Metis.
 *
 * The account launch's checks, in its order, before a single call is handed over: Metis is open, the plan
 * is the session's, it is approved (with `approve`, launching approves the revision on screen), and the
 * plan's limits allow it. The answer is the four calls the account launch sends (create, approve, fund,
 * activate), built for the session's wallet as the vault's owner. Without `approve` and without an
 * approved plan it answers the budget and the vault address only, so a page can read the wallet's
 * balances before asking for anything.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const rl = rateLimit("submit", clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { approve?: unknown; expectedRevision?: unknown; chainId?: unknown };
  const r = await prepareOwnWallet(founder, id, {
    approve: body.approve === true,
    expectedRevision: typeof body.expectedRevision === "number" ? body.expectedRevision : undefined,
    chainId: typeof body.chainId === "number" ? body.chainId : undefined,
  });
  if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason, error: r.message, upgradeTo: r.upgradeTo ?? null }, { status: ownWalletStatus(r.reason) });
  return NextResponse.json(r);
}
