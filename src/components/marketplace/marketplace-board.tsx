"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Zap, UserCheck, Clock, Users, EyeOff, Wallet } from "lucide-react";
import type { MarketplaceRow } from "@/lib/campaigns/marketplace";
import type { SettlementRail } from "@/lib/db/schema";

/**
 * THE MARKETPLACE BOARD — a job board for paid testing work.
 *
 * The horizontal-rail version read like a content shelf: pleasant, and completely wrong for the
 * question a stranger arrives with, which is "is there real money here". A board answers that by
 * being DENSE and by putting the amount where the eye lands — one row per mission, the reward set
 * hard right in tabular figures, scanning down the column instead of sideways through cards.
 *
 * Sorting runs client-side over the set the server already sent, so switching is instant.
 */

type SortKey = "top" | "low" | "slots" | "quick";

/**
 * WHERE THIS MISSION PAYS, in a tester's terms rather than the chain's.
 *
 * The board is a mix of rails and a tester holds one wallet, so without this the first sign that a
 * mission needs a different wallet is the submit button refusing them — after the work is done.
 * Starknet leads with what it BUYS the tester (a payout nobody can read off a public ledger), not
 * with the chain's name, because that is the part they care about.
 */
const RAIL_LABEL: Record<SettlementRail, string> = {
  evm: "GOAT",
  starknet: "Starknet · private",
};

const SORTS: { key: SortKey; label: string }[] = [
  { key: "top", label: "Highest paying" },
  { key: "low", label: "Lowest first" },
  { key: "slots", label: "Most slots" },
  { key: "quick", label: "Quickest" },
];

const EFFORT_RANK = { quick: 0, standard: 1, deep: 2 } as const;

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/** A product mark from its own initial — recognisable at a glance without fetching a favicon. */
function Mark({ host, title }: { host: string | null; title: string }) {
  const source = host ?? title;
  const letter = (source.replace(/^www\./, "")[0] ?? "?").toUpperCase();
  // Deterministic hue from the host so the same product always wears the same colour.
  let h = 0;
  for (const c of source) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className="mk-mark" style={{ background: `hsl(${h} 42% 94%)`, color: `hsl(${h} 55% 32%)` }}>
      {letter}
    </span>
  );
}

export function MarketplaceBoard({
  rows,
  viewerRails,
}: {
  rows: MarketplaceRow[];
  /**
   * The rails the viewer has actually signed in on — both, if they hold both, because the two
   * sessions are independent cookies and neither displaces the other.
   *
   * Empty means signed out, and a signed-out visitor is told where each mission pays but never
   * that they "can't" claim it: they have not chosen a wallet yet, so there is no conflict to
   * warn about. The nudge appears only once it is true of them.
   */
  viewerRails?: SettlementRail[];
}) {
  const [sort, setSort] = useState<SortKey>("top");

  const sorted = useMemo(() => {
    const xs = [...rows];
    switch (sort) {
      case "low":
        return xs.sort((a, b) => a.rewardUsd - b.rewardUsd);
      case "slots":
        return xs.sort((a, b) => b.remainingSlots - a.remainingSlots || b.rewardUsd - a.rewardUsd);
      case "quick":
        return xs.sort(
          (a, b) => EFFORT_RANK[a.effort] - EFFORT_RANK[b.effort] || b.rewardUsd - a.rewardUsd,
        );
      default:
        return xs.sort((a, b) => b.rewardUsd - a.rewardUsd || b.remainingSlots - a.remainingSlots);
    }
  }, [rows, sort]);

  return (
    <>
      {/* Sticky, so the sort you want stays reachable at row 80 as it was at row 1. */}
      <div className="mk-toolbar">
        <nav className="mk-sorts" aria-label="Sort missions">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`mk-sort${sort === s.key ? " is-on" : ""}`}
              aria-pressed={sort === s.key}
              onClick={() => setSort(s.key)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <span className="mk-count mono">
          {sorted.length} {sorted.length === 1 ? "mission" : "missions"}
        </span>
      </div>

      <ul className="mk-list">
        {sorted.map((r) => {
          // NEVER HIDE, NEVER DISABLE. Work on the other rail is still real work and still open —
          // the tester just needs a second wallet, which is a sentence, not a locked door. Removing
          // these rows would shrink the market every founder is paying to reach.
          const needsOtherWallet =
            (viewerRails?.length ?? 0) > 0 && !viewerRails!.includes(r.settlementRail);
          return (
          <li key={r.key}>
            <Link href={r.boardPath} className={`mk-row${needsOtherWallet ? " is-otherrail" : ""}`}>
              <Mark host={r.productHost} title={r.campaignTitle} />

              <span className="mk-row-main">
                <span className="mk-row-title">{r.title}</span>
                <span className="mk-row-meta">
                  <span className="mk-row-host">{r.productHost ?? r.campaignTitle}</span>
                  <span className="mk-dot" aria-hidden>
                    ·
                  </span>
                  <span className="mk-row-chip">
                    <Clock size={11} />
                    {r.effort}
                  </span>
                  <span className="mk-row-chip">
                    <Users size={11} />
                    {r.remainingSlots} of {r.maxCompletions} left
                  </span>
                  <span className="mk-row-chip">
                    {r.autopays ? <Zap size={11} /> : <UserCheck size={11} />}
                    {r.autopays ? "auto-pays" : "founder approves"}
                    {/* Public work: one person, one slot — said on the row, proven at the mission. */}
                    <span className="mk-dot">·</span> one person, one slot
                  </span>
                  <span className="mk-row-chip">
                    {r.settlementRail === "starknet" ? <EyeOff size={11} /> : <Wallet size={11} />}
                    {RAIL_LABEL[r.settlementRail]}
                  </span>
                  {needsOtherWallet && (
                    <span className="mk-row-chip mk-row-chip-wallet">
                      needs a {r.settlementRail === "starknet" ? "Starknet" : "GOAT"} wallet
                    </span>
                  )}
                  {r.isTestnet && <span className="mk-row-chip mk-row-chip-test">testnet</span>}
                </span>
              </span>

              <span className="mk-row-pay">
                <span className="mk-row-amount mono">{usd(r.rewardUsd)}</span>
                {r.denominated && <span className="mk-row-denom mono">{r.denominated}</span>}
                <span className="mk-row-token mono">{r.tokenSymbol}</span>
              </span>
            </Link>
          </li>
          );
        })}
      </ul>
    </>
  );
}
