import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { getSessionAddress } from "@/lib/auth/session";
import { chainConfig } from "@/lib/deputy/networks";
import { prepareSelfWithdrawal, submitSelfWithdrawal } from "@/lib/wallet/self-withdraw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Gasless withdrawal from the signed-in wallet. `prepare` hands back the exact EIP-3009 typed data
 * to sign; `submit` verifies the signature is this wallet's own and the operator pays the gas.
 * `from` is always the session wallet — never a field the caller chooses.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const wallet = await getSessionAddress();
  if (!wallet) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) return NextResponse.json({ ok: false, error: "Give an Ethereum address to send to (0x…, 40 hex characters)." }, { status: 400 });
  try {
    if (body.action === "prepare") {
      const usd = Number(body.amountUsd);
      if (!Number.isFinite(usd) || usd <= 0) return NextResponse.json({ ok: false, error: "Give an amount in USDC." }, { status: 400 });
      const amountBase = BigInt(Math.round(usd * 1_000_000));
      const p = await prepareSelfWithdrawal({ from: wallet, to, amountBase });
      // bigint → strings for the wire; the client rebuilds them for the signature
      const m = p.typedData.message;
      return NextResponse.json({
        ok: true,
        ...p,
        typedData: { ...p.typedData, message: { ...m, value: m.value.toString(), validAfter: m.validAfter.toString(), validBefore: m.validBefore.toString() } },
      });
    }
    if (body.action === "submit") {
      const amountBase = BigInt(String(body.amountBase ?? "0"));
      const validBefore = Number(body.validBefore);
      const nonce = String(body.nonce ?? "") as Hex;
      const signature = String(body.signature ?? "") as Hex;
      if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return NextResponse.json({ ok: false, error: "malformed signature" }, { status: 400 });
      const r = await submitSelfWithdrawal({ from: wallet, to, amountBase, validBefore, nonce, signature });
      return NextResponse.json({ ok: true, txHash: r.txHash, explorerTx: `${chainConfig(2345).explorerUrl}/tx/${r.txHash}`, amountUsd: Number(r.amountBase) / 1_000_000, to: r.to });
    }
    return NextResponse.json({ ok: false, error: "action must be prepare or submit" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "withdrawal failed" }, { status: 400 });
  }
}
