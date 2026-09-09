import { NextResponse, type NextRequest } from "next/server";
import { getAddress } from "viem";
import { getFounderAddress } from "@/lib/auth/founder";
import { getWebTreasury } from "@/lib/treasury/web";
import { withdrawViaPrivy } from "@/lib/privy/withdraw";
import { accountBalanceBase } from "@/lib/treasury/activity";
import { explorerTxUrl } from "@/lib/deputy/networks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Withdraw from the account to any address the founder names. The mandate does not allow this by
 * itself: a scoped permit — this recipient, this amount, nothing else — is attached for the one
 * transfer and the wallet is re-locked to the mandate straight after, whatever happened.
 */
export async function POST(req: NextRequest) {
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const t = getWebTreasury(founder);
  if (!t) return NextResponse.json({ ok: false, error: "There is no account to withdraw from yet." }, { status: 404 });
  let body: { to?: unknown; amountUsd?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) return NextResponse.json({ ok: false, error: "Give an address to send to (0x…, 40 hex characters)." }, { status: 400 });
  const usd = Number(body.amountUsd);
  if (!Number.isFinite(usd) || usd <= 0) return NextResponse.json({ ok: false, error: "Give an amount in USDC." }, { status: 400 });
  const amountBase = BigInt(Math.round(usd * 1_000_000));
  const balance = await accountBalanceBase(t.privyWalletAddress, t.chainId);
  if (amountBase > balance) return NextResponse.json({ ok: false, error: `The account holds ${(Number(balance) / 1e6).toFixed(2)} USDC; that is less than ${usd.toFixed(2)}.` }, { status: 400 });
  try {
    const r = await withdrawViaPrivy(t, getAddress(to), amountBase);
    return NextResponse.json({ ok: true, txHash: r.txHash, explorerUrl: explorerTxUrl(t.chainId, r.txHash), amountUsd: usd, to: getAddress(to) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 220) : "withdrawal failed" }, { status: 400 });
  }
}
