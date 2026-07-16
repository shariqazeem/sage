"use client";

import Link from "next/link";
import { ArrowUpRight, Check, X } from "lucide-react";
import { usd, short, since } from "@/lib/format";
import type { PayoutReceipt } from "@/lib/deputy/chain";
import { useInView } from "./use-in-view";

/**
 * ACT 4 — PROOF, LIVE. The real on-chain payout history, restyled as receipt
 * cards that cascade in on scroll. Settled payouts AND blocked attempts both
 * show (every decision is public), each linking to its real /proof/<tx>. One
 * IntersectionObserver on the grid drives a CSS nth-child cascade. If the feed
 * is empty, an honest empty state — never fabricated rows.
 */
export function Act4Proof({
  feed,
  now,
  networkName,
}: {
  feed: PayoutReceipt[];
  now: number;
  networkName: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.08 });
  const rows = feed.slice(0, 8);

  return (
    <section className="clx-act clx-act4" aria-label="Proof">
      <div className="clx-act4-in">
        <div className="clx-act4-head">
          <div className="clx-pill">
            <span className="clx-dot" />
            <span className="clx-mono">Live · {networkName}</span>
          </div>
          <h2 className="clx-h2">
            Every payout is public. Every block is public.
          </h2>
          <p className="clx-act4-sub">
            Allowed or blocked, every decision the wallet makes is a checkable
            on-chain record. Nothing settles you can&apos;t trace; nothing moves the
            limits didn&apos;t permit.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="clx-receipts-empty">
            <span className="clx-receipt-ico pos">
              <Check size={16} strokeWidth={3} />
            </span>
            <div>
              <div className="clx-receipt-title">Wallet live — watching for work</div>
              <div className="clx-receipt-sub">
                When Sage pays, every receipt lands here — public and
                checkable. No rows are shown until a real payout settles.
              </div>
            </div>
          </div>
        ) : (
          <div
            ref={ref}
            className={`clx-receipts${inView ? " is-in" : ""}`}
          >
            {rows.map((r, i) => (
              <Link
                key={`${r.txHash}-${i}`}
                href={`/proof/${r.txHash}`}
                className={`clx-receipt${r.settled ? "" : " blocked"}`}
                style={{ ["--i" as string]: i }}
              >
                <div className="clx-receipt-top">
                  <span className={`clx-receipt-ico ${r.settled ? "pos" : "dan"}`}>
                    {r.settled ? (
                      <Check size={15} strokeWidth={3} />
                    ) : (
                      <X size={15} strokeWidth={2.6} />
                    )}
                  </span>
                  <span className="clx-receipt-ago clx-mono">
                    {since(r.timestamp, now)}
                  </span>
                </div>
                <div className="clx-receipt-amt clx-mono">
                  {r.settled ? usd(r.amount) : "Blocked"}
                </div>
                <div className="clx-receipt-title">
                  {r.settled ? "Payout settled" : "Attempt blocked on-chain"}
                </div>
                <div className="clx-receipt-sub clx-mono">
                  {r.settled ? "to " : ""}
                  {short(r.recipient)}
                </div>
                <div className="clx-receipt-foot clx-mono">
                  View proof <ArrowUpRight size={13} strokeWidth={2.2} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
