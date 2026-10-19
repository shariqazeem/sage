import { NextResponse, type NextRequest } from "next/server";
import { getFounderAddress } from "@/lib/auth/founder";
import { getWebTreasuryOn } from "@/lib/treasury/web";
import { withdrawViaPrivy } from "@/lib/privy/withdraw";
import { accountBalanceBase } from "@/lib/treasury/activity";
import { nativeBalanceWei } from "@/lib/telegram/agent-wallet-tools";
import { grantGasStipend, gasRefusalMessage } from "@/lib/treasury/gas-stipend";
import { minLaunchGasWei } from "@/lib/treasury/gas-policy";
import { acquireLock, releaseLock } from "@/lib/db/campaigns";
import { chainConfig, explorerTxUrl } from "@/lib/deputy/networks";
import { publicClient } from "@/lib/deputy/chain";
import { isPlanId, PLANS } from "@/lib/plans/catalog";
import { billingAddress, isBillingChain, readPlanPayment } from "@/lib/plans/billing";
import { applyPlanPayment, quotePlan } from "@/lib/plans/apply-payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** A USDC transfer is ~50k gas; this is the native balance below which one may not go through. */
const TRANSFER_GAS = BigInt(120_000);

/**
 * POST { plan, chainId }: pay a plan from the founder's own account, in one click. The email-first
 * door: someone who signed in with an email has no browser wallet to send from, and their money is
 * already in the account.
 *
 * The same scoped permit as a withdrawal (this recipient, this amount, nothing else), then the wallet
 * is re-locked to its mandate whatever happened. The receipt is then READ, exactly as a wallet
 * payment is, so the plan is extended by what the chain shows, not by what this route believes it
 * sent. One payment at a time per founder: a double click must not pay twice.
 */
export async function POST(req: NextRequest) {
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const to = billingAddress();
  if (!to) return NextResponse.json({ ok: false, error: "Plan payments aren't configured on this deployment." }, { status: 503 });
  let body: { plan?: unknown; chainId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (!isPlanId(body.plan)) return NextResponse.json({ ok: false, error: "Choose a plan." }, { status: 400 });
  if (!isBillingChain(body.chainId)) return NextResponse.json({ ok: false, error: "Plans are paid on Metis or GOAT Network." }, { status: 400 });
  const plan = body.plan;
  const chainId = body.chainId;
  const network = chainConfig(chainId).name;

  const t = getWebTreasuryOn(founder, chainId);
  if (!t) return NextResponse.json({ ok: false, error: `You don't have an account on ${network} yet. Open it on your account page, or pay from a wallet.` }, { status: 404 });
  const q = quotePlan(founder, plan);
  if (!q.ok) return NextResponse.json({ ok: false, error: q.error }, { status: q.status });

  const lock = `plan-pay:${founder.toLowerCase()}`;
  if (!acquireLock(lock, 180)) return NextResponse.json({ ok: false, error: "A payment is already going through. Give it a moment." }, { status: 409 });
  try {
    const balance = await accountBalanceBase(t.privyWalletAddress, chainId);
    if (balance < q.priceBase) {
      return NextResponse.json({ ok: false, error: `${PLANS[plan].name} is ${q.priceUsd} USDC and your account on ${network} holds ${(Number(balance) / 1e6).toFixed(2)}. Add funds first, or pay from a wallet.` }, { status: 400 });
    }
    // The transfer needs network fee money. If only that is missing, the operator covers it once,
    // the same stipend a launch gets.
    const gasPrice = await publicClient(chainId).getGasPrice().catch(() => BigInt(0));
    const gas = await nativeBalanceWei(t.privyWalletAddress, chainId);
    if (gasPrice > BigInt(0) && gas < TRANSFER_GAS * gasPrice) {
      const stipend = await grantGasStipend({ chainId, wallet: t.privyWalletAddress, walletUsdcBase: balance, budgetBase: q.priceBase, gasWei: gas, minGasWei: minLaunchGasWei(chainId) });
      if (!stipend.granted) return NextResponse.json({ ok: false, error: gasRefusalMessage(stipend.reason, t.privyWalletAddress, chainId) }, { status: 400 });
    }
    let sent: { txHash: `0x${string}` };
    try {
      sent = await withdrawViaPrivy(t, to, q.priceBase);
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 220) : "The payment didn't go through." }, { status: 400 });
    }
    // The executor waited for the transaction; a node can still lag a second behind it.
    let check = await readPlanPayment({ chainId, txHash: sent.txHash, payers: [t.privyWalletAddress], minBase: q.priceBase });
    for (let i = 0; i < 3 && !check.ok && "retryable" in check; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      check = await readPlanPayment({ chainId, txHash: sent.txHash, payers: [t.privyWalletAddress], minBase: q.priceBase });
    }
    if (!check.ok) {
      // The money left; the receipt isn't readable yet. The hash is the founder's proof: it can be
      // applied from Settings with the wallet door, which reads the same receipt.
      return NextResponse.json({ ok: false, error: `Sent, but Sage couldn't confirm it yet (${check.reason}). Paste this transaction into Settings to apply it: ${sent.txHash}`, txHash: sent.txHash }, { status: 202 });
    }
    applyPlanPayment(q, { txHash: sent.txHash, chainId, payer: t.privyWalletAddress, amountBase: check.amountBase });
    return NextResponse.json({ ok: true, plan, planUntil: q.until, amountUsd: q.priceUsd, txHash: sent.txHash, explorerUrl: explorerTxUrl(chainId, sent.txHash) });
  } finally {
    releaseLock(lock);
  }
}
