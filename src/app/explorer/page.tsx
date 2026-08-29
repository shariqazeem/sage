import "./explorer.css";
import type { Metadata } from "next";
import Link from "next/link";

import { SageMark } from "@/components/brand/sage-mark";
import { ExplorerSearch } from "@/components/explorer/explorer-search";
import { getAgentChainSplit, getPublicReceipts } from "@/lib/erc8004/reputation";
import { countDecidedSubmissions } from "@/lib/db/campaigns";
import { chainConfig } from "@/lib/deputy/networks";
import { short, usd } from "@/lib/format";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sage Explorer — every settlement and every refusal, live",
  description:
    "The public ledger of Sage's autonomous payouts: every settlement with its on-chain receipt, every refusal with its reason, every wallet with its verified work record. Search any transaction or wallet.",
  alternates: { canonical: `${siteUrl()}/explorer` },
};

/**
 * THE SAGE EXPLORER (FC Phase 2) — the infrastructure surface. Chains have explorers; a payment
 * layer that wants to be trusted like one shows the same face: every settlement AND every refusal,
 * newest first, each linking to its canonical object (receipt, record). All numbers derive from
 * the same deduped journal the landing uses — nothing here can disagree with the homepage.
 */

const ago = (unixSec: number, now: number): string => {
  const s = Math.max(0, Math.floor(now / 1000 - unixSec));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129_600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
};

export default function ExplorerPage() {
  /**
   * EVERY MAINNET RAIL, NOT JUST GOAT.
   *
   * This page is headed "Every settlement. Every refusal." and it filtered to chain 2345, so the
   * moment Sage settled a real payout on a second rail the ledger claiming to list all of them
   * quietly stopped doing so. A missing payment on the page whose whole purpose is completeness is
   * worse than a page that never claimed it.
   *
   * Testnets stay out: a test payout is not a settlement, and mixing valueless tokens into a total
   * headed "settled, verified" would inflate it with money that does not exist.
   */
  const isMainnetRail = (chainId: number | null | undefined) =>
    chainId != null && chainConfig(chainId).isMainnet;

  const feed = getPublicReceipts(40).filter((r) => isMainnetRail(r.chainId));
  const rails = getAgentChainSplit().filter((c) => isMainnetRail(c.chainId));
  const paid = rails.reduce((sum, c) => sum + (c.settledUsd ?? 0), 0);
  const payouts = rails.reduce((sum, c) => sum + (c.payouts ?? 0), 0);
  /**
   * REFUSALS COME FROM THE LEDGER, NOT THE CHAIN FEED.
   *
   * `blocks` is aggregated from on-chain reputation events keyed by chainId+tx. A refusal never
   * produces a transaction, so it could never appear there — and this page read "0 refusals on
   * record · 0% refusal share" while the ledger held 23. The page's own claim is that refusals are
   * listed with the same prominence because they are what make the payments mean something, so
   * showing none was the one number it could not afford to get wrong.
   *
   * Settlements still come from the chain-anchored feed: a payout must be provable on-chain.
   */
  const decided = countDecidedSubmissions();
  const blocks = decided.rejected;
  const judged = decided.paid + decided.rejected;
  const refusalShare = judged > 0 ? Math.round((blocks / judged) * 100) : 0;
  const now = Date.now();

  return (
    <div className="exp">
      <div className="exp-col">
        <div className="spp-top" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none", color: "inherit", fontWeight: 650 }}>
            <SageMark size={26} />
            <span>Sage</span>
          </Link>
          <span style={{ fontSize: 12, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--ink-faint, #8a8f98)" }}>
            Explorer
          </span>
        </div>

        <header className="exp-head">
          <h1 className="exp-title">Every settlement. Every refusal.</h1>
          <p className="exp-sub">
            The public ledger of Sage&rsquo;s autonomous payouts — each one verified before it
            moved, each one anchored to an on-chain transaction. Refusals are listed with the same
            prominence: they are what make the payments mean something.
          </p>
        </header>

        <ExplorerSearch />

        <section className="exp-stats" aria-label="Live totals">
          <div className="exp-stat">
            <div className="exp-stat-v">{usd(paid)}</div>
            <div className="exp-stat-k">Settled, verified</div>
          </div>
          <div className="exp-stat">
            <div className="exp-stat-v">{payouts}</div>
            <div className="exp-stat-k">Mainnet payouts</div>
          </div>
          <div className="exp-stat">
            <div className="exp-stat-v">{blocks}</div>
            <div className="exp-stat-k">Refusals on record</div>
          </div>
          <div className="exp-stat">
            <div className="exp-stat-v">{refusalShare}%</div>
            <div className="exp-stat-k">Refusal share</div>
          </div>
        </section>

        <p className="exp-sec">Latest activity</p>
        {feed.length === 0 ? (
          <p className="exp-hint">No settlements yet.</p>
        ) : (
          <ul className="exp-list" aria-label="Latest settlements and refusals">
            {feed.map((r) => (
              <li key={`${r.chainId}:${r.txHash}`}>
                <Link href={`/proof/${r.txHash}`} className="exp-row">
                  <span className={`exp-amt ${r.settled ? "ok" : "no"}`}>
                    {r.settled ? usd(r.amount) : "refused"}
                  </span>
                  <span className="exp-what">
                    <span className="exp-line">
                      {r.settled ? `paid to ${short(r.recipient)}` : `refused — verification check ${r.failedCheckIndex ?? 0} failed`}
                      {" · "}
                      {/* Which rail settled it. With more than one, a bare amount no longer
                          says where to go and verify it. */}
                      {chainConfig(r.chainId).chipLabel}
                    </span>
                    <span className="exp-meta">{r.txHash}</span>
                  </span>
                  <span className="exp-when">{ago(r.timestamp, now)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <footer className="exp-trust">
          Every settled row links to its <b>proof receipt</b>, and every recipient wallet has a
          public <b>verified work record</b> at <span className="mono">/record/&lt;wallet&gt;</span>{" "}
          with lender-consumable credit signals. These totals count settlements on mainnet rails
          only — a testnet payout moves no real money, so it is not a settlement. Vault-settled
          payouts run inside on-chain caps,
          recipients are screened against the OFAC SDN list, and no human reviewed any autonomous
          decision — read{" "}
          <Link href="/docs/compliance">how the controls work</Link>.
        </footer>
      </div>
    </div>
  );
}
