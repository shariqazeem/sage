import "./receipt.css";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFounderAddress } from "@/lib/auth/founder";
import { SageMark } from "@/components/brand/sage-mark";
import { getPlanPayment, memberRole, walletMemberKey } from "@/lib/db/workspaces";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { canManage } from "@/lib/workspaces/context";
import { chainConfig, explorerTxUrl } from "@/lib/deputy/networks";
import { isPlanId, PLANS } from "@/lib/plans/catalog";
import { receiptNumber } from "@/lib/plans/billing-view";
import { promoOnPayment } from "@/lib/plans/promo";
import { PrintReceipt } from "./print-receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Receipt", robots: { index: false } };

const day = (sec: number) => new Date(sec * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const METHOD: Record<string, string> = { balance: "Sage balance", wallet: "Wallet", renewal: "Sage balance, automatic renewal" };

/**
 * THE RECEIPT FOR A PLAN PAYMENT. The workspace's owner and admins can open it; it is a business
 * document, so it is never indexed and never public, though the transaction it names is on chain for
 * anyone to check. Every line is read from the payment row and the chain's own identifiers.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ tx: string }> }) {
  const { tx } = await params;
  const founder = await getFounderAddress();
  if (!founder) redirect(`/start?next=${encodeURIComponent(`/billing/receipt/${tx}`)}`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) notFound();
  const payment = getPlanPayment(tx);
  if (!payment) notFound();
  const ws = db.select().from(workspaces).where(eq(workspaces.id, payment.workspaceId)).get();
  if (!ws || !canManage(memberRole(ws.id, walletMemberKey(founder)))) notFound();
  const plan = isPlanId(payment.plan) ? payment.plan : "pro";
  const promo = promoOnPayment(payment.txHash);
  const network = chainConfig(payment.chainId).name;
  const amount = (payment.amountBase / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <main className="rc">
      <header className="rc-head">
        <Link href="/" className="rc-brand">
          <SageMark size={22} />
          <span>Sage</span>
        </Link>
        <div className="rc-title">
          <h1>Receipt</h1>
          <p>{receiptNumber(payment.txHash, payment.paidAt)}</p>
        </div>
      </header>

      <div className="rc-paid">
        <div>
          <b>${amount}</b> <span>USDC</span>
        </div>
        <span className="rc-chip">paid {day(payment.paidAt)}</span>
      </div>

      <dl>
        <div>
          <dt>Billed to</dt>
          <dd>{ws.name}</dd>
        </div>
        <div>
          <dt>Plan</dt>
          <dd>Sage {PLANS[plan].name}</dd>
        </div>
        <div>
          <dt>Period</dt>
          <dd>
            {day(payment.periodStart ?? payment.paidAt)} to {day(payment.planUntil)}
          </dd>
        </div>
        {promo && (
          <div>
            <dt>Promo code</dt>
            <dd>
              {promo.code}, {promo.percentOff}% off
            </dd>
          </div>
        )}
        <div>
          <dt>Paid with</dt>
          <dd>{payment.method ? METHOD[payment.method] : "USDC"} on {network}</dd>
        </div>
        <div>
          <dt>From</dt>
          <dd className="mono">{payment.payer}</dd>
        </div>
        <div>
          <dt>Transaction</dt>
          <dd className="mono">
            <a href={explorerTxUrl(payment.chainId, payment.txHash)} target="_blank" rel="noreferrer">
              {payment.txHash}
            </a>
          </dd>
        </div>
      </dl>

      <p className="rc-note">
        Paid in USDC on {network}. Sage read this payment on chain before the plan changed; the transaction above is the proof, and anyone can check it on the network&apos;s explorer.
        Sage takes no fee on payouts, and your live jobs keep paying people whatever happens to your plan.
      </p>

      <div className="rc-actions">
        <PrintReceipt />
        <Link href="/workspace/settings#plan" className="rc-back">
          Back to billing
        </Link>
      </div>
    </main>
  );
}
