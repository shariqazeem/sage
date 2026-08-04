"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Zap, UserCheck, ArrowRight } from "lucide-react";
import type { MarketplaceRow } from "@/lib/campaigns/marketplace";

/**
 * THE MARKETPLACE BOARD — open missions, laid out to be scanned sideways and compared.
 *
 * A tester picks a TASK, not a campaign. A campaign-first vertical list makes them open three boards
 * to compare two rewards, so this is mission-first: one card per mission, in horizontal rails they
 * can flick through, with the sort they actually care about (what pays most) one tap away.
 *
 * Sorting is client-side over the full set the server already sent — no refetch, no spinner, so
 * switching between "highest paying" and "quickest" is instant.
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

/** One horizontal, scroll-snapped rail with arrow controls that stay usable by keyboard. */
function Rail({ title, hint, rows }: { title: string; hint: string; rows: MarketplaceRow[] }) {
  const ref = useRef<HTMLDivElement>(null);
  // Arrows appear only when there is somewhere to go. A control that does nothing when clicked is
  // worse than no control — and with two tiles on a wide screen the rail does not scroll at all.
  const [scrollable, setScrollable] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setScrollable(el.scrollWidth - el.clientWidth > 4);
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, rows.length]);

  const nudge = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    // Scroll by roughly one card so a click always lands on a card boundary.
    el.scrollBy({ left: dir * Math.min(el.clientWidth * 0.85, 640), behavior: "smooth" });
  };
  if (rows.length === 0) return null;

  return (
    <section className="mk-rail-sec">
      <header className="mk-rail-head">
        <div>
          <h2 className="dash-h3 mk-rail-title">{title}</h2>
          <p className="sage-hint mk-rail-hint">{hint}</p>
        </div>
        {scrollable && (
          <div className="mk-rail-nav">
            <button type="button" aria-label={`Scroll ${title} left`} onClick={() => nudge(-1)}>
              <ChevronLeft size={16} />
            </button>
            <button type="button" aria-label={`Scroll ${title} right`} onClick={() => nudge(1)}>
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </header>

      <div className="mk-rail" ref={ref}>
        {rows.map((r) => (
          <Link key={r.key} href={r.boardPath} className="mk-tile">
            <div className="mk-tile-top">
              <span className="mk-tile-host mono">{r.productHost ?? r.campaignTitle}</span>
              <span className="mk-tile-pay mono">{usd(r.rewardUsd)}</span>
            </div>

            <h3 className="mk-tile-title">{r.title}</h3>
            <p className="mk-tile-obj">{r.objective}</p>

            <div className="mk-tile-tags">
              <span className={`mk-tag mk-tag-${r.effort}`}>{r.effort}</span>
              <span className="mk-tag">
                {r.remainingSlots} of {r.maxCompletions} left
              </span>
              {r.isTestnet && <span className="mk-tag mk-tag-test">testnet</span>}
            </div>

            <div className="mk-tile-foot">
              <span className="mk-tile-pays">
                {r.autopays ? <Zap size={12} /> : <UserCheck size={12} />}
                {r.autopays ? "Auto-pays once verified" : "Founder approves"}
              </span>
              <span className="mk-tile-go">
                Open <ArrowRight size={13} />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
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

  // Rails only make sense when there is enough to fill more than one; below that a single rail
  // reads as the whole list, which is the truth.
  const byProduct = useMemo(() => {
    const m = new Map<string, MarketplaceRow[]>();
    for (const r of sorted) {
      const k = r.campaignId;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()];
  }, [sorted]);

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

      <Rail
        title={sort === "low" ? "Lowest paying first" : sort === "quick" ? "Quickest first" : sort === "slots" ? "Most slots open" : "Best paying right now"}
        hint={`${sorted.length} open ${sorted.length === 1 ? "mission" : "missions"}`}
        rows={sorted}
      />

      {byProduct.length > 1 &&
        byProduct.map(([id, rs]) => (
          <Rail
            key={id}
            title={rs[0]!.campaignTitle}
            hint={`${rs.length} open ${rs.length === 1 ? "mission" : "missions"} on ${rs[0]!.productHost ?? "this product"}`}
            rows={rs}
          />
        ))}
    </>
  );
}
