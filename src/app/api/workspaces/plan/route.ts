import { NextResponse, type NextRequest } from "next/server";
import { getFounderAddress } from "@/lib/auth/founder";
import { declaredLinksOf } from "@/lib/campaigns/wallet-links";
import { setAutoRenew } from "@/lib/db/workspaces";
import { personRole } from "@/lib/workspaces/person-role";
import { canManage } from "@/lib/workspaces/context";
import { isPlanId, PERIOD_DAYS, PLANS, SELF_SERVE } from "@/lib/plans/catalog";
import { planPriceUsd } from "@/lib/plans/billing-math";
import { billingAddress, isBillingChain, readPlanPayment } from "@/lib/plans/billing";
import { founderPlan } from "@/lib/plans/founder-plan";
import { applyPlanPayment, quotePlan } from "@/lib/plans/apply-payment";
import { billingView } from "@/lib/plans/billing-view";
import { paymentPromo } from "@/lib/plans/promo";
import { listWebTreasuries } from "@/lib/treasury/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: what each plan costs and, signed in, the founder's billing view (the plan in force, its
 * renewal, the Sage balance it renews from, and every payment with its receipt). Signed out, only the
 * prices and where they are paid.
 */
export async function GET() {
  const founder = await getFounderAddress();
  const plans = SELF_SERVE.map((id) => ({ id, name: PLANS[id].name, priceUsd: planPriceUsd(id) }));
  if (!founder) return NextResponse.json({ periodDays: PERIOD_DAYS, plans, view: null });
  return NextResponse.json({ periodDays: PERIOD_DAYS, plans, view: await billingView(founder, { readBalance: "always" }) });
}

/**
 * POST { plan, chainId, txHash, autoRenew?, promo? }: the founder paid a plan in USDC from a wallet that is
 * theirs (the one they're signed in with, one they declared, or their own Sage balance). Sage reads the
 * receipt, finds the transfer, and extends the plan. Nothing is trusted from the body except which
 * transaction to read, and the renewal choice, which is saved once the payment is applied.
 */
export async function POST(req: NextRequest) {
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!billingAddress()) return NextResponse.json({ error: "Plan payments aren't configured on this deployment." }, { status: 503 });
  let body: { plan?: unknown; chainId?: unknown; txHash?: unknown; autoRenew?: unknown; promo?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const plan = body.plan === undefined ? "pro" : body.plan;
  if (!isPlanId(plan)) return NextResponse.json({ error: "Choose a plan." }, { status: 400 });
  if (!isBillingChain(body.chainId)) return NextResponse.json({ error: "Plans are paid in USDC on Metis." }, { status: 400 });
  const chainId = body.chainId;
  const txHash = typeof body.txHash === "string" ? body.txHash.trim() : "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return NextResponse.json({ error: "That doesn't look like a transaction hash." }, { status: 400 });

  // A percent code lowers what this payment must be, priced from the code here, never from the client.
  const promo = paymentPromo(founder, body.promo, plan);
  if (!promo.ok) return NextResponse.json({ error: promo.error }, { status: 400 });
  const q = quotePlan(founder, plan, undefined, promo.promo);
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: q.status });
  // Theirs: the wallet they're signed in with, wallets they declared as theirs, and their own balances.
  const balances = listWebTreasuries(founder).map((t) => t.privyWalletAddress.toLowerCase());
  const payers = [founder, ...declaredLinksOf(founder), ...balances];
  const check = await readPlanPayment({ chainId, txHash: txHash as `0x${string}`, payers, minBase: q.priceBase });
  if (!check.ok) {
    const retryable = "retryable" in check && check.retryable;
    return NextResponse.json({ error: `Payment not found: ${check.reason}.`, retryable }, { status: retryable ? 409 : 400 });
  }
  const method = balances.includes(check.from.toLowerCase()) ? "balance" : "wallet";
  const row = applyPlanPayment(q, { txHash, chainId, payer: check.from, amountBase: check.amountBase, method });
  if (!row) return NextResponse.json({ error: "That payment was already applied." }, { status: 409 });
  if (typeof body.autoRenew === "boolean") setAutoRenew(q.workspace.id, body.autoRenew);
  return NextResponse.json({ ok: true, plan: q.plan, planUntil: q.until, amountUsd: Number(check.amountBase) / 1e6, txHash, receiptUrl: `/billing/receipt/${txHash.toLowerCase()}` });
}

/**
 * PATCH { autoRenew }: turn the plan's automatic renewal on or off. Off, the plan runs to the end of its
 * period and is then Free again; on, it renews from the Sage balance. The owner or an admin only.
 */
export async function PATCH(req: NextRequest) {
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: { autoRenew?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body.autoRenew !== "boolean") return NextResponse.json({ error: "Say whether the plan should renew." }, { status: 400 });
  const ws = founderPlan(founder).workspace;
  if (!ws) return NextResponse.json({ error: "There's no plan to renew yet." }, { status: 404 });
  if (!canManage(personRole(ws, founder))) return NextResponse.json({ error: "Only the workspace owner or an admin can change how the plan renews." }, { status: 403 });
  setAutoRenew(ws.id, body.autoRenew);
  return NextResponse.json({ ok: true, autoRenew: body.autoRenew });
}
