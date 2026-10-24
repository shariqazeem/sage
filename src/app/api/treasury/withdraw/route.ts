import { NextResponse, type NextRequest } from "next/server";
import { getAddress, parseUnits } from "viem";
import { getFounderAddress } from "@/lib/auth/founder";
import { getWebTreasuryOn } from "@/lib/treasury/web";
import { treasuryChainId } from "@/lib/privy/onboarding";
import { withdrawViaPrivy } from "@/lib/privy/withdraw";
import { AccountBusyError } from "@/lib/privy/scoped";
import { accountBalanceBase } from "@/lib/treasury/activity";
import { publicClient } from "@/lib/deputy/chain";
import { chainConfig, explorerTxUrl } from "@/lib/deputy/networks";
import { maxWithdrawBase } from "@/lib/treasury/withdraw-max";
import { needsFeeMessage, SWAP_GAS_UNITS, TRANSFER_GAS_UNITS } from "@/lib/treasury/gas-policy";
import { sendNativeFromAccount } from "@/lib/treasury/send-native";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Send money out of the account to any address the founder names: USDC (the default), or the
 * network's gas token (METIS on Metis) with `asset: "native"`. The mandate allows neither by itself:
 * a scoped permit (this recipient, this amount, nothing else) is attached for the one transfer and
 * the wallet is re-locked to the mandate straight after, whatever happened. The account pays the
 * network fee; one it can't pay is refused here, in words, before anything is signed.
 */
export async function POST(req: NextRequest) {
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  let body: { to?: unknown; amountUsd?: unknown; amount?: unknown; asset?: unknown; chainId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const chainId = typeof body.chainId === "number" && Number.isFinite(body.chainId) ? body.chainId : treasuryChainId();
  const t = getWebTreasuryOn(founder, chainId);
  if (!t) return NextResponse.json({ ok: false, error: "There is no account to withdraw from yet." }, { status: 404 });
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) return NextResponse.json({ ok: false, error: "Give an address to send to (0x…, 40 hex characters)." }, { status: 400 });
  if (!rateLimit("accountMove", founder.toLowerCase()).ok) return NextResponse.json({ ok: false, error: "One move at a time. Give it a moment." }, { status: 429 });
  const c = chainConfig(t.chainId);

  // The gas token: parsed exactly, sent through its own permit.
  if (body.asset === "native") {
    const raw = typeof body.amount === "string" ? body.amount.trim() : typeof body.amount === "number" ? String(body.amount) : "";
    let wei: bigint;
    try {
      wei = /^\d+(\.\d+)?$/.test(raw) ? parseUnits(raw, 18) : BigInt(0);
    } catch {
      wei = BigInt(0);
    }
    if (wei <= BigInt(0)) return NextResponse.json({ ok: false, error: `Give an amount of ${c.nativeSymbol}.` }, { status: 400 });
    const r = await sendNativeFromAccount(founder, t, getAddress(to), wei);
    if (!r.ok) return NextResponse.json({ ok: false, code: r.code, error: r.message }, { status: r.code === "busy" ? 409 : 400 });
    return NextResponse.json({ ok: true, asset: "native", txHash: r.txHash, explorerUrl: r.explorerUrl, to: r.to });
  }

  const usd = Number(body.amountUsd);
  if (!Number.isFinite(usd) || usd <= 0) return NextResponse.json({ ok: false, error: "Give an amount in USDC." }, { status: 400 });
  const amountBase = BigInt(Math.round(usd * 1_000_000));
  const balance = await accountBalanceBase(t.privyWalletAddress, t.chainId);
  if (amountBase > balance) return NextResponse.json({ ok: false, error: `The account holds ${(Number(balance) / 1e6).toFixed(2)} USDC; that is less than ${usd.toFixed(2)}.` }, { status: 400 });
  // Where USDC is also the gas (Arc), a transfer of the whole balance cannot pay its own fee and reverts
  // on chain. Refuse it here, in words, with the amount that will go through.
  const max = maxWithdrawBase(balance, t.chainId);
  if (amountBase > max) {
    return NextResponse.json({ ok: false, error: `On ${c.name}, USDC also pays the network fee, so a cent has to stay behind. The most you can withdraw now is ${(Math.floor(Number(max) / 10_000) / 100).toFixed(2)} USDC.` }, { status: 400 });
  }
  // Where the fee is a separate token (METIS on Metis), the account must hold a little of it.
  if (c.nativeSymbol !== "USDC") {
    const client = publicClient(t.chainId);
    const [gasWei, gasPrice] = await Promise.all([client.getBalance({ address: getAddress(t.privyWalletAddress) }), client.getGasPrice()]);
    const feeWei = (TRANSFER_GAS_UNITS * gasPrice * BigInt(12)) / BigInt(10);
    if (gasWei < feeWei) {
      return NextResponse.json({ ok: false, code: "gas", error: needsFeeMessage({ chainId: t.chainId, action: "withdrawal", needWei: feeWei, haveWei: gasWei, swapFeeWei: SWAP_GAS_UNITS * gasPrice, nativeSymbol: c.nativeSymbol, network: c.name }) }, { status: 400 });
    }
  }
  try {
    const r = await withdrawViaPrivy(t, getAddress(to), amountBase);
    return NextResponse.json({ ok: true, asset: "usdc", txHash: r.txHash, explorerUrl: explorerTxUrl(t.chainId, r.txHash), amountUsd: usd, to: getAddress(to) });
  } catch (e) {
    if (e instanceof AccountBusyError) return NextResponse.json({ ok: false, code: "busy", error: e.message }, { status: 409 });
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 220) : "withdrawal failed" }, { status: 400 });
  }
}
