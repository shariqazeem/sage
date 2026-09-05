import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { getSessionAddress } from "@/lib/auth/session";
import { chainConfig, GOAT_USDC } from "@/lib/deputy/networks";
import { readTokenState, VALID_FOR_SECONDS } from "@/lib/privy/recipient-withdraw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in wallet's own money: where to deposit, what it holds. EVM sessions only — USDC on GOAT. */
export async function GET(): Promise<NextResponse> {
  const wallet = await getSessionAddress();
  if (!wallet) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const address = getAddress(wallet);
  const chainId = 2345;
  try {
    const state = await readTokenState(chainId, getAddress(GOAT_USDC), address);
    return NextResponse.json({
      ok: true,
      address,
      chainId,
      network: chainConfig(chainId).name,
      token: GOAT_USDC,
      usdcBase: state.balance.toString(),
      usd: Number(state.balance) / 1_000_000,
      explorerUrl: `${chainConfig(chainId).explorerUrl}/address/${address}`,
      validForSeconds: VALID_FOR_SECONDS,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "could not read the balance" }, { status: 502 });
  }
}
