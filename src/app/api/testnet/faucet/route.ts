import { NextResponse, type NextRequest } from "next/server";
import { encodeFunctionData, getAddress, isAddress } from "viem";

import { getSessionAddress } from "@/lib/auth/session";
import { chainConfig } from "@/lib/deputy/networks";
import { faucetPolicy } from "@/lib/launch/preview-core";
import { configuredMockUsdc } from "@/lib/launch/preview";
import { LAUNCH_CHAIN_ID } from "@/lib/launch/deployment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MINT_ABI = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

/** A generous but bounded testnet drip (100 test USDC, 6dp). */
const FAUCET_AMOUNT_BASE = BigInt(100_000_000);

/**
 * POST /api/testnet/faucet — eligibility + the mint calldata for the founder's OWN wallet
 * to send. The server NEVER mints (no key, no broadcast). It hard-asserts Metis Sepolia
 * (59902) and the exact configured MockUSDC; on any mainnet or unknown chain/token the
 * faucet is refused. The returned token has no value — the founder confirms the mint in
 * their wallet.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSessionAddress();
  if (!session) return NextResponse.json({ ok: false, error: "Connect and sign in first." }, { status: 401 });

  let body: { chainId?: number; recipient?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* defaults below */
  }
  const chainId = body.chainId ?? LAUNCH_CHAIN_ID;
  const token = chainConfig(chainId).usdcAddress;
  const policy = faucetPolicy(chainId, token ?? "0x", configuredMockUsdc());
  if (!policy.available) {
    // Mainnet / wrong token / unconfigured → refused (never reachable off testnet).
    return NextResponse.json({ ok: false, available: false, error: policy.reason }, { status: 400 });
  }

  const recipient = body.recipient && isAddress(body.recipient) ? getAddress(body.recipient) : session;
  const data = encodeFunctionData({ abi: MINT_ABI, functionName: "mint", args: [recipient, FAUCET_AMOUNT_BASE] });

  return NextResponse.json({
    ok: true,
    available: true,
    chainId,
    token: policy.token,
    amountBase: FAUCET_AMOUNT_BASE.toString(),
    note: "Test-only token with no value. You confirm the mint in your wallet.",
    mintCall: { to: policy.token, data, value: "0" },
  });
}
