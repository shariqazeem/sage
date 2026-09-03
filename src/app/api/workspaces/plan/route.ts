import { NextResponse, type NextRequest } from "next/server";
import { getAddress } from "viem";
import { workspaceContext, canManage } from "@/lib/workspaces/context";
import { getWorkspace, memberRole, recordPlanPayment } from "@/lib/db/workspaces";
import { extendedUntil, findUsdcPayment } from "@/lib/workspaces/plan-payment";
import { PRO_PERIOD_SECONDS, proPriceUsd } from "@/lib/workspaces/plan";
import { publicClient } from "@/lib/deputy/chain";
import { GOAT_USDC } from "@/lib/deputy/networks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GOAT = 2345;

/** Where a Pro payment goes: Sage's operator wallet on GOAT (the same one the vaults name). */
export function operatorAddress(): string | null {
  const raw = process.env.GOAT_OPERATOR_ADDRESS?.trim() || process.env.NEXT_PUBLIC_OPERATOR_ADDRESS?.trim();
  try {
    return raw ? getAddress(raw) : null;
  } catch {
    return null;
  }
}

/** GET — what to pay, where, in what. */
export async function GET() {
  const to = operatorAddress();
  if (!to) return NextResponse.json({ error: "Pro payments aren't configured on this deployment." }, { status: 503 });
  return NextResponse.json({ chainId: GOAT, token: GOAT_USDC, to, priceUsd: proPriceUsd(), periodDays: PRO_PERIOD_SECONDS / 86_400 });
}

/**
 * POST { workspaceId, txHash } — the owner paid Pro in USDC on GOAT from the wallet they are signed
 * in with; Sage reads the receipt, finds the transfer, and extends the plan by one period. A hash is
 * spent once. Nothing is trusted from the body except which transaction to read.
 */
export async function POST(req: NextRequest) {
  const ctx = await workspaceContext();
  if (!ctx) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const to = operatorAddress();
  if (!to) return NextResponse.json({ error: "Pro payments aren't configured on this deployment." }, { status: 503 });
  let body: { workspaceId?: unknown; txHash?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const ws = typeof body.workspaceId === "string" ? getWorkspace(body.workspaceId) : null;
  if (!ws) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  if (!canManage(memberRole(ws.id, ctx.memberKey))) return NextResponse.json({ error: "Only the workspace owner or an admin can change the plan." }, { status: 403 });
  const txHash = typeof body.txHash === "string" ? body.txHash.trim() : "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return NextResponse.json({ error: "That doesn't look like a transaction hash." }, { status: 400 });
  let payer: string;
  try {
    payer = getAddress(ctx.address);
  } catch {
    return NextResponse.json({ error: "Pro is paid from an Ethereum wallet on GOAT for now — sign in with one to pay." }, { status: 400 });
  }
  let receipt: { status: "success" | "reverted"; logs: { address: `0x${string}`; data: `0x${string}`; topics: [`0x${string}`, ...`0x${string}`[]] | [] }[] };
  try {
    receipt = await publicClient(GOAT).getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch {
    return NextResponse.json({ error: "Couldn't read that transaction yet — give it a few seconds and try again.", retryable: true }, { status: 409 });
  }
  if (receipt.status !== "success") return NextResponse.json({ error: "That transaction reverted — no payment was made." }, { status: 400 });
  const minBase = BigInt(Math.round(proPriceUsd() * 100)) * BigInt(10_000);
  const check = findUsdcPayment(receipt.logs.filter((l) => l.topics.length > 0) as Parameters<typeof findUsdcPayment>[0], { usdc: GOAT_USDC, to, from: payer, minBase });
  if (!check.ok) return NextResponse.json({ error: `Payment not found: ${check.reason}.` }, { status: 400 });
  const now = Math.floor(Date.now() / 1000);
  const planUntil = extendedUntil(ws.planUntil, now, PRO_PERIOD_SECONDS);
  const row = recordPlanPayment({ txHash, workspaceId: ws.id, chainId: GOAT, payer, amountBase: check.amountBase, planUntil });
  if (!row) return NextResponse.json({ error: "That payment was already applied." }, { status: 409 });
  return NextResponse.json({ ok: true, plan: "pro", planUntil, amountUsd: Number(check.amountBase) / 1e6 });
}
