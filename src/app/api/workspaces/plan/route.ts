import { NextResponse, type NextRequest } from "next/server";
import { getFounderAddress } from "@/lib/auth/founder";
import { declaredLinksOf } from "@/lib/campaigns/wallet-links";
import { chainConfig } from "@/lib/deputy/networks";
import { isPlanId, PERIOD_DAYS, PLANS, SELF_SERVE } from "@/lib/plans/catalog";
import { planPriceUsd } from "@/lib/plans/billing-math";
import { billingAddress, billingChains, isBillingChain, readPlanPayment } from "@/lib/plans/billing";
import { founderPlan, founderUsage } from "@/lib/plans/founder-plan";
import { applyPlanPayment, quotePlan } from "@/lib/plans/apply-payment";
import { listWebTreasuries } from "@/lib/treasury/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: what each plan costs, where to pay it, and (signed in) the plan in force and its usage. */
export async function GET() {
  const to = billingAddress();
  const founder = await getFounderAddress();
  const current = founder ? founderPlan(founder) : null;
  const usage = founder ? founderUsage(founder) : null;
  return NextResponse.json({
    to,
    periodDays: PERIOD_DAYS,
    chains: billingChains().map((id) => ({ chainId: id, network: chainConfig(id).name, token: chainConfig(id).usdcAddress })),
    plans: SELF_SERVE.map((id) => ({ id, name: PLANS[id].name, priceUsd: planPriceUsd(id) })),
    current: current ? { plan: current.plan, until: current.until, workspaceId: current.workspace?.id ?? null } : null,
    usage: usage ? { liveJobs: usage.liveJobs, launchedUsd: Number(usage.launchedBase) / 1e6 } : null,
  });
}

/**
 * POST { plan, chainId, txHash }: the founder paid a plan in USDC from a wallet that is theirs (the
 * one they're signed in with, or one they declared as theirs). Sage reads the receipt, finds the
 * transfer, and extends the plan. Nothing is trusted from the body except which transaction to read.
 */
export async function POST(req: NextRequest) {
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!billingAddress()) return NextResponse.json({ error: "Plan payments aren't configured on this deployment." }, { status: 503 });
  let body: { plan?: unknown; chainId?: unknown; txHash?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  // Older clients paid Pro on GOAT and sent neither field.
  const plan = body.plan === undefined ? "pro" : body.plan;
  const chainId = body.chainId === undefined ? 2345 : body.chainId;
  if (!isPlanId(plan)) return NextResponse.json({ error: "Choose a plan." }, { status: 400 });
  if (!isBillingChain(chainId)) return NextResponse.json({ error: "Plans are paid on Metis or GOAT Network." }, { status: 400 });
  const txHash = typeof body.txHash === "string" ? body.txHash.trim() : "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return NextResponse.json({ error: "That doesn't look like a transaction hash." }, { status: 400 });

  const q = quotePlan(founder, plan);
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: q.status });
  // Theirs: the wallet they're signed in with, wallets they declared as theirs, and their own accounts.
  const payers = [founder, ...declaredLinksOf(founder), ...listWebTreasuries(founder).map((t) => t.privyWalletAddress)];
  const check = await readPlanPayment({ chainId, txHash: txHash as `0x${string}`, payers, minBase: q.priceBase });
  if (!check.ok) {
    const retryable = "retryable" in check && check.retryable;
    return NextResponse.json({ error: `Payment not found: ${check.reason}.`, retryable }, { status: retryable ? 409 : 400 });
  }
  const row = applyPlanPayment(q, { txHash, chainId, payer: check.from, amountBase: check.amountBase });
  if (!row) return NextResponse.json({ error: "That payment was already applied." }, { status: 409 });
  return NextResponse.json({ ok: true, plan: q.plan, planUntil: q.until, amountUsd: Number(check.amountBase) / 1e6 });
}
