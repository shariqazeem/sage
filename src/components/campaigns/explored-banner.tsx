"use client";

import { Eye } from "lucide-react";
import { CountUp } from "@/components/app/count-up";
import { useInView } from "@/components/landing/use-in-view";

/**
 * P26 — the "agent is the star" hero band on a tester board: Sage's own exploration breadth,
 * given prominence with counts that tick up when the banner scrolls into view. Purely presentational;
 * the numbers come verbatim from the campaign's recorded exploration (never fabricated). The wording +
 * its meaning are the P23 truth surface, unchanged: Sage judges the account against what it saw itself.
 */
export function ExploredBanner({ screens, elements }: { screens: number; elements: number }) {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.4 });
  return (
    <div ref={ref} className="tb-explored-hero">
      <div className="tb-explored-ico">
        <Eye size={18} />
      </div>
      <div className="tb-explored-body">
        <div className="tb-explored-stat">
          <CountUp className="tb-explored-n" value={inView ? screens : 0} /> screen
          {screens === 1 ? "" : "s"}
          {elements > 0 && (
            <>
              {" · "}
              <CountUp className="tb-explored-n" value={inView ? elements : 0} /> element
              {elements === 1 ? "" : "s"}
            </>
          )}
        </div>
        <div className="tb-explored-cap">
          <b>Sage explored this product itself</b> — and judges your account against what it saw for
          itself, not a checklist.
        </div>
      </div>
    </div>
  );
}
