import { NextResponse, type NextRequest } from "next/server";
import { getFounderAddress } from "@/lib/auth/founder";
import { setAutoRenew } from "@/lib/db/workspaces";
import { isPlanId } from "@/lib/plans/catalog";
import { billingChains, isBillingChain } from "@/lib/plans/billing";
import { payPlanFromBalance } from "@/lib/plans/pay-from-balance";
import { quotePlan } from "@/lib/plans/apply-payment";
import { paymentPromo } from "@/lib/plans/promo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST { plan, chainId?, autoRenew?, promo? }: pay a plan from the founder's Sage balance, in one click, the way
 * a saved card pays. The email-first door: someone who signed in with an email has no browser wallet to
 * send from, and their money is already in the balance. The work (the scoped permit, the network fee
 * Sage covers, reading the receipt before the plan changes, one payment at a time) is
 * `payPlanFromBalance`, shared with the automatic renewal so the two can never disagree.
 *
 * `autoRenew` is the checkout's "renew automatically" box: on by default, saved only once the payment
 * went through.
 */
export async function POST(req: NextRequest) {
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  let body: { plan?: unknown; chainId?: unknown; autoRenew?: unknown; promo?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (!isPlanId(body.plan)) return NextResponse.json({ ok: false, error: "Choose a plan." }, { status: 400 });
  const chainId = body.chainId === undefined ? billingChains()[0] : body.chainId;
  if (!isBillingChain(chainId)) return NextResponse.json({ ok: false, error: "Plans are paid in USDC on Metis." }, { status: 400 });

  const plan = body.plan;
  const promo = paymentPromo(founder, body.promo, plan);
  if (!promo.ok) return NextResponse.json({ ok: false, error: promo.error }, { status: 400 });
  const r = await payPlanFromBalance({ founder, plan, chainId, method: "balance" }, { quote: () => quotePlan(founder, plan, undefined, promo.promo) });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, code: r.code, txHash: r.txHash }, { status: r.status });
  if (typeof body.autoRenew === "boolean") setAutoRenew(r.workspaceId, body.autoRenew);
  return NextResponse.json({ ok: true, plan: r.plan, planUntil: r.until, amountUsd: r.amountUsd, txHash: r.txHash, explorerUrl: r.explorerUrl, receiptUrl: `/billing/receipt/${r.txHash}` });
}
