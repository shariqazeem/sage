import Link from "next/link";
import { SageMark } from "@/components/brand/sage-mark";
import type { LiveReceipt } from "@/lib/site/live-proof";

const usd = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (s: string, a = 6, b = 4) => (s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : s);

/** "3 days ago", from the server's clock: no client clock, so the page renders the same everywhere. */
export function ago(sec: number, nowSec = Math.floor(Date.now() / 1000)): string {
  const d = Math.max(0, nowSec - sec);
  if (d < 90) return "just now";
  if (d < 3600) return `${Math.round(d / 60)} minutes ago`;
  if (d < 86_400) return `${Math.round(d / 3600)} hours ago`;
  const days = Math.round(d / 86_400);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/**
 * THE PRODUCT SHOT IS A REAL RECEIPT. The latest real-money payout Sage made, drawn the way a
 * receipt reads, linking to its public proof page. Nothing renders when there is no payout yet:
 * an invented one would be the first lie a stranger reads.
 */
export function ReceiptCard({ r }: { r: LiveReceipt }) {
  return (
    <Link href={`/proof/${r.txHash}`} className="receipt receipt-link" aria-label={`Receipt: ${usd(r.amountUsd)} USDC paid on ${r.network}`}>
      <div className="receipt-top">
        <span className="receipt-brand">
          <SageMark size={20} /> Sage
        </span>
        <span className="receipt-chip">Verified and paid</span>
      </div>
      <div className="receipt-amount mono">
        ${usd(r.amountUsd)}
        <small>USDC</small>
      </div>
      <div className="receipt-lines">
        {r.job && (
          <div className="receipt-line">
            <span>For</span>
            <span className="receipt-text receipt-clip">{r.job}</span>
          </div>
        )}
        {r.recipient && (
          <div className="receipt-line">
            <span>Paid to</span>
            <span>{short(r.recipient)}</span>
          </div>
        )}
        <div className="receipt-line">
          <span>Network</span>
          <span className="receipt-text">{r.network}</span>
        </div>
        <div className="receipt-line">
          <span>Transaction</span>
          <span>{short(r.txHash, 8, 6)}</span>
        </div>
      </div>
      <div className="receipt-foot">
        <span>{ago(r.at)}</span>
        <span className="more">View receipt</span>
      </div>
    </Link>
  );
}

/** The latest receipts as rows: payouts green, each linking to its proof. */
export function ReceiptRows({ receipts, nowSec }: { receipts: readonly LiveReceipt[]; nowSec?: number }) {
  if (receipts.length === 0) return <div className="rows"><div className="row-empty">The first payout will appear here the moment it settles.</div></div>;
  return (
    <div className="rows">
      {receipts.map((r) => (
        <Link key={`${r.chainId}:${r.txHash}`} href={`/proof/${r.txHash}`} className="row">
          <span className="row-dot" aria-hidden />
          <span className="row-main">
            <span className="row-title">{r.job ?? "A verified payout"}</span>
            <span className="row-sub">
              {r.network} · {ago(r.at, nowSec)}
              {r.recipient ? ` · to ${short(r.recipient)}` : ""}
            </span>
          </span>
          <span className="row-amt">${usd(r.amountUsd)}</span>
        </Link>
      ))}
    </div>
  );
}
