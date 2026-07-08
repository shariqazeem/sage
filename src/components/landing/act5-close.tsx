"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { usd } from "@/lib/format";
import { CountUpLanding } from "./count-up-landing";

/**
 * ACT 5 — CLOSE. The one dark surface on the landing (ink #1a1d21), for contrast
 * weight. The one-liner again, the CTA, and three mono stats that count up from
 * real on-chain history: total settled USDC, payouts count, blocks count.
 */
export function Act5Close({
  totalReleased,
  payoutsCount,
  blocksCount,
}: {
  totalReleased: number;
  payoutsCount: number;
  blocksCount: number;
}) {
  return (
    <section className="clx-act clx-act5" aria-label="Hire your first Deputy">
      <div className="clx-act5-in">
        <h2 className="clx-close-h">
          Give an AI agent an allowance&nbsp;— not your keys.
        </h2>
        <p className="clx-close-p">
          Hire an autonomous worker that pays real people for real work — and
          physically cannot spend a dollar you didn&apos;t approve.
        </p>

        <div className="clx-close-actions">
          <Link href="/app" className="clx-cta clx-cta-invert">
            Hire your first Deputy <ArrowRight size={16} strokeWidth={2.4} />
          </Link>
        </div>

        <div className="clx-close-stats">
          <div className="clx-close-stat">
            <span className="clx-close-stat-v">
              <CountUpLanding value={totalReleased} format={usd} />
            </span>
            <span className="clx-close-stat-k clx-mono">Settled on-chain</span>
          </div>
          <span className="clx-close-statdiv" />
          <div className="clx-close-stat">
            <span className="clx-close-stat-v">
              <CountUpLanding value={payoutsCount} />
            </span>
            <span className="clx-close-stat-k clx-mono">Payouts</span>
          </div>
          <span className="clx-close-statdiv" />
          <div className="clx-close-stat">
            <span className="clx-close-stat-v">
              <CountUpLanding value={blocksCount} />
            </span>
            <span className="clx-close-stat-k clx-mono">Blocked outside policy</span>
          </div>
        </div>
      </div>
    </section>
  );
}
