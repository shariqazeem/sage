import { NextResponse, type NextRequest } from "next/server";
import { getFounderAddress } from "@/lib/auth/founder";
import { launchFromTreasury } from "@/lib/treasury/launch";
import { isLaunchChain } from "@/lib/launch/deployment-service";
import { treasuryChainId } from "@/lib/privy/onboarding";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { chainId? } — the agent deploys, funds and activates this plan's vault from the founder's
 * account. Without a chain, the account on the default chain; with one, the account on that chain
 * (an Arc testnet account, today), which must be a chain the server is configured to launch on.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rl = rateLimit("submit", clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { chainId?: unknown };
  const chainId = typeof body.chainId === "number" && Number.isFinite(body.chainId) ? body.chainId : treasuryChainId();
  if (!isLaunchChain(chainId)) return NextResponse.json({ error: "That chain is not one Sage launches on here." }, { status: 400 });
  const r = await launchFromTreasury(founder, id, chainId);
  if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason, error: r.message }, { status: r.reason === "not_yours" ? 403 : r.reason === "failed" ? 500 : 409 });
  return NextResponse.json({ ok: true, campaignId: r.campaignId, vault: r.vault, url: `${siteUrl()}/c/${r.campaignId}`, steps: r.steps });
}
