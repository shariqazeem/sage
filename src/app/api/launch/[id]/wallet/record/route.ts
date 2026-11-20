import { NextResponse, type NextRequest } from "next/server";
import { getFounderAddress } from "@/lib/auth/founder";
import { recordOwnWallet } from "@/lib/own-wallet/server";
import { ownWalletStatus } from "@/lib/own-wallet/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { vault? } — record the vault the session's own wallet deployed and funded, and call the job live.
 *
 * Nothing the browser says is believed. The vault is the one this wallet and the approved plan produce
 * (a named vault that differs is refused); the server then reads the chain itself and requires that
 * Sage's factory created it for this wallet, that its operator, token, budget, rewards, places and limits
 * are the compiled plan's, that it holds the whole budget and is active, and that its owner (the only
 * address the contract lets fund it) is the session's wallet. Then the account launch's own recorder
 * re-checks it and persists the job. Safe to call twice: a job already recorded answers the same.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const rl = rateLimit("submit", clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { vault?: unknown; chainId?: unknown };
  const r = await recordOwnWallet(founder, id, {
    vault: typeof body.vault === "string" ? body.vault : undefined,
    chainId: typeof body.chainId === "number" ? body.chainId : undefined,
  });
  if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason, error: r.message, mismatches: r.mismatches ?? null }, { status: ownWalletStatus(r.reason) });
  return NextResponse.json({ ok: true, campaignId: r.campaignId, vault: r.vault, url: `${siteUrl()}/c/${r.campaignId}` });
}
