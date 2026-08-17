import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { formatDuration, getTesterSupply } from "@/lib/campaigns/tester-supply";

/**
 * THE ANSWER TO "WILL ANYONE ACTUALLY TEST MY PRODUCT?"
 *
 * A founder looking at a finished plan sees missions, prices and an Approve button — and nothing at
 * all about whether testers exist. They are not hesitating over $5; they are hesitating because
 * funding a campaign nobody answers is embarrassing and irreversible. Every fact that settles the
 * question was already in the database and shown nowhere.
 *
 * Real numbers only, recomputed per render. If nobody had been paid yet this would render nothing
 * rather than a hopeful zero — an empty marketplace should never be dressed up as a busy one.
 */
export function TesterSupplyProof({ compact = false }: { compact?: boolean }) {
  const s = getTesterSupply();
  if (s.testersPaid === 0) return null;

  return (
    <section className={`tsp${compact ? " tsp-compact" : ""}`} aria-label="Tester supply">
      <p className="tsp-eyebrow">Testers are already here</p>
      <p className="tsp-lede">
        <strong>{s.testersPaid} people</strong> have been paid for verified testing work on Sage —{" "}
        <strong>${s.usdcSettled.toFixed(2)} USDC</strong> settled on GOAT Mainnet, every payout a
        public transaction.
      </p>

      <dl className="tsp-stats">
        <div>
          <dt>Missions paid</dt>
          <dd>{s.missionsPaid}</dd>
        </div>
        <div>
          <dt>Typical time to payout</dt>
          <dd>{formatDuration(s.medianSecondsToPayout)}</dd>
        </div>
        <div>
          <dt>Paid this week</dt>
          <dd>{s.paidLast7Days}</dd>
        </div>
        <div>
          <dt>Not paid out</dt>
          <dd>{s.heldOrRejectedPct}%</dd>
        </div>
      </dl>

      <p className="tsp-note">
        That last number matters as much as the others: Sage held or refused{" "}
        {s.heldOrRejectedPct}% of submissions. You are funding verified work, not attendance — and no
        human reviewed any of it.
      </p>

      {!compact && (
        <Link href="/marketplace" className="tsp-link">
          See the missions testers are working on <ArrowRight size={14} strokeWidth={2} />
        </Link>
      )}
    </section>
  );
}
