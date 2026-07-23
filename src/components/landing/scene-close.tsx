import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { usd } from "@/lib/format";
import { Reveal } from "./reveal";

/**
 * CLOSE — the single dark contrast act. The thesis line, one primary action, and the
 * real live totals beneath it (same server source as everything else).
 */
export function SceneClose({
  totals,
  networkName,
}: {
  totals: { paidUsd: number; payoutCount: number; blockedCount: number };
  networkName: string;
}) {
  return (
    <section className="cl" aria-label="Get started">
      <Reveal className="reveal cl-in">
        <h2 className="cl-h">
          An agent with eyes,
          <br />
          judgment, and a wallet.
        </h2>
        <p className="cl-sub">
          Give Sage a product and a small budget. It will find what deserves testing,
          recruit real people, verify the work, and pay inside the rules you approved.
        </p>
        <div className="cl-actions">
          <Link href="/dashboard" className="btn cl-cta-primary">
            Launch your first campaign <ArrowRight size={17} strokeWidth={2.2} />
          </Link>
          <Link href="/c/founding-testers" className="btn cl-cta-ghost">
            Explore live missions
          </Link>
        </div>
        <div className="cl-stats mono">
          <span className="cl-stat">
            <b>{usd(totals.paidUsd)}</b> paid to real testers
          </span>
          <span className="cl-dot" aria-hidden />
          <span className="cl-stat">
            <b>{totals.payoutCount}</b> verified payout{totals.payoutCount === 1 ? "" : "s"}
          </span>
          <span className="cl-dot" aria-hidden />
          <span className="cl-stat">live on {networkName}</span>
        </div>
      </Reveal>
    </section>
  );
}
