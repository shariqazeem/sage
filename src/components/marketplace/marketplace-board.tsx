"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Zap, UserCheck, Clock, Users } from "lucide-react";
import type { MarketplaceRow } from "@/lib/campaigns/marketplace";

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

export function MarketplaceBoard({ rows }: { rows: MarketplaceRow[] }) {
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

      <ul className="mk-list">
        {sorted.map((r) => (
          <li key={r.key}>
            <Link href={r.boardPath} className="mk-row">
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
                  </span>
                  {r.isTestnet && <span className="mk-row-chip mk-row-chip-test">testnet</span>}
                </span>
              </span>

              <span className="mk-row-pay">
                <span className="mk-row-amount mono">{usd(r.rewardUsd)}</span>
                <span className="mk-row-token mono">{r.tokenSymbol}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
