"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Compass, Eye, Lock, MousePointer2, ShieldCheck, Wand2, X } from "lucide-react";
import { usd } from "@/lib/format";
import type { Showcase } from "@/lib/landing/showcase";

/**
 * WORKFLOW — "One URL becomes a campaign." A sticky visual stage pinned beside three
 * chapters (Explore → Design → Verify). Native scrolling is preserved; an
 * IntersectionObserver simply swaps the pinned visual as each chapter reaches center.
 * On mobile the stage un-pins and each chapter carries its own visual. Reduced-motion /
 * pre-JS: chapter 0 shows, everything legible.
 */
const CHAPTERS = [
  {
    n: "01",
    tag: "Explore",
    Icon: Eye,
    title: "Sage enters the product itself.",
    body: "No brief, no guesswork. Sage opens the real product in its own browser, moves through it, and records the states and controls it actually sees.",
  },
  {
    n: "02",
    tag: "Design",
    Icon: Wand2,
    title: "Every mission begins with something Sage actually saw.",
    body: "Observed facts condense into paid missions. Each criterion is linked to the source it came from, the budget is allocated deterministically, and anything Sage can’t ground is dropped.",
  },
  {
    n: "03",
    tag: "Verify",
    Icon: ShieldCheck,
    title: "A tester can claim the work. Sage still checks for itself.",
    body: "When someone submits, Sage opens a fresh, isolated browser and replays the same safe action. Only when the expected outcome appears does a verification permit exist.",
  },
  {
    n: "04",
    tag: "Decide",
    Icon: Compass,
    title: "Then it decides what to buy next.",
    body: "Work that gets claimed earns a larger budget next time; work nobody comes to is stopped and the money returns. Sage proposes each move with its reason and its price before anything is spent, and waits — you can stop it, or tell it to go now. It can never spend past your ceilings, price its own work, or buy against a product you did not name.",
  },
];

export function SceneWorkflow({ showcase }: { showcase: Showcase | null }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    // Desktop pinning: the active chapter is the one whose HEADING sits nearest an
    // activation line ~40% down the viewport (the heading is what the reader tracks —
    // and it is vertically centred in each tall chapter). Deterministic, so the last
    // chapter (Verify) becomes fully active while its heading + copy are clearly in
    // view, not only once they have nearly scrolled off the top. Driven by BOTH a
    // scroll listener (real wheel/trackpad scrolling) and an IntersectionObserver
    // (reliable across engines + programmatic scroll) so it can never stall.
    let raf = 0;
    const recompute = () => {
      raf = 0;
      const line = window.innerHeight * 0.4;
      let best = 0;
      let bestDist = Infinity;
      refs.current.forEach((el, i) => {
        if (!el) return;
        const heading = el.querySelector("h3") ?? el;
        const r = heading.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - line);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      setActive(best);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(recompute);
    };
    const io = new IntersectionObserver(schedule, { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] });
    refs.current.forEach((r) => r && io.observe(r));
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    recompute();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <section id="how" className="wf scene" aria-label="How Sage works">
      <div className="wrap">
        <div className="wf-head">
          <span className="eyebrow">Fund once, then stop deciding</span>
          <h2 className="h2">You watch the agent work — see, design, verify, then decide again.</h2>
        </div>

        <div className="wf-grid">
          <div className="wf-stage-col">
            <div className="wf-stage" data-active={active}>
              {showcase ? <RealVisual active={active} sc={showcase} /> : <WfVisual active={active} />}
            </div>
          </div>

          <div className="wf-chapters">
            {CHAPTERS.map((c, i) => (
              <div
                key={c.n}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                className="wf-chapter"
                data-active={active === i ? "1" : "0"}
              >
                <div className="wf-chapter-k mono">
                  <span className="wf-n">{c.n}</span>
                  <span className="wf-tag">
                    <c.Icon size={14} strokeWidth={2} /> {c.tag}
                  </span>
                </div>
                <h3 className="h3">{c.title}</h3>
                <p className="wf-body">{c.body}</p>
                {/* mobile-only inline visual */}
                <div className="wf-stage wf-stage-inline" data-active={i}>
                  {showcase ? <RealVisual active={i} sc={showcase} /> : <WfVisual active={i} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function WfVisual({ active }: { active: number }) {
  return (
    <div className="wfv">
      <div className="wfv-browser">
        <div className="wfv-chrome">
          <span className="wfv-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="wfv-url mono">
            <Lock size={11} strokeWidth={2.4} />
            {active === 2 ? "fresh session · replay" : "app.yourproduct.com"}
          </span>
        </div>
        <div className="wfv-body">
          {active === 0 && (
            <>
              <div className="wfv-line w-60" />
              <div className="wfv-line w-80" />
              <div className="wfv-line w-45" />
              <span className="wfv-chip c1">observed · heading</span>
              <span className="wfv-chip c2">observed · input</span>
              <span className="wfv-chip c3">action · Start</span>
              <MousePointer2 className="wfv-cursor" size={18} strokeWidth={2.2} fill="currentColor" />
            </>
          )}
          {active === 1 && (
            <div className="wfv-mission">
              <div className="wfv-mission-h mono">
                <Wand2 size={13} strokeWidth={2} /> Mission · grounded
              </div>
              <div className="wfv-mission-t">Click “Start” and reach the garden</div>
              <div className="wfv-crit">
                <span className="mono">criterion</span>
                <span className="wfv-link" />
                <span className="mono">observed · Start</span>
              </div>
              <div className="wfv-mission-f">
                <span className="wfv-reward mono">reward $0.40</span>
                <span className="wfv-ghost mono">
                  <X size={11} strokeWidth={2.6} /> ungrounded mission dropped
                </span>
              </div>
            </div>
          )}
          {active === 2 && (
            <>
              <div className="wfv-line w-45" />
              <div className="wfv-replay-row">
                <span className="wfv-replay-act mono">
                  <MousePointer2 size={12} strokeWidth={2.4} fill="currentColor" /> click “Start”
                </span>
                <span className="wfv-replay-ok mono">
                  <Check size={12} strokeWidth={3} /> garden observed
                </span>
              </div>
              <div className="wfv-permit">
                <span className="wfv-permit-ic">
                  <ShieldCheck size={13} strokeWidth={2} />
                </span>
                <span className="mono">verification permit minted</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


/**
 * THE REAL RUN. One mission Sage designed for a real product, and the verdict that paid it —
 * loaded from the ledger, never typed in. Chapter 1 shows what Sage observed (the mission's
 * own criteria are observed facts about the product), chapter 2 the mission as it shipped to
 * the board, chapter 3 the decision: each criterion met or not, with the verbatim quote the
 * judge cited. The sketch above remains only as the fallback for an empty ledger.
 */
function RealVisual({ active, sc }: { active: number; sc: Showcase }) {
  if (active === 0) {
    return (
      <div className="art">
        <div className="art-h">
          <span>What Sage saw · {sc.targetHost}</span>
          <span className="real">real run</span>
        </div>
        <p className="art-t">{sc.campaignTitle}</p>
        <ul className="art-list">
          {sc.mission.criteria.slice(0, 3).map((c, i) => (
            <li key={i}><span className="k">observed</span><span>{c}</span></li>
          ))}
        </ul>
        <div className="art-f">
          <span>Recorded in Sage&rsquo;s own browser, before any mission existed.</span>
        </div>
      </div>
    );
  }
  if (active === 1) {
    return (
      <div className="art">
        <div className="art-h">
          <span>Mission · {sc.mission.verifiabilityClass === "url-verifiable" ? "url-verifiable" : "observation-based"}</span>
          <span className="real">real run</span>
        </div>
        <p className="art-t">{sc.mission.title}</p>
        <ul className="art-list">
          {sc.mission.criteria.slice(0, 3).map((c, i) => (
            <li key={i}><span className="k">criterion</span><span>{c}</span></li>
          ))}
        </ul>
        <div className="art-f">
          <span>reward <b className="mono">{usd(sc.mission.rewardBase / 1_000_000)}</b> · allocated deterministically</span>
          <span>{sc.railLabel}</span>
        </div>
      </div>
    );
  }
  const quoted = sc.decision.criteria.find((c) => c.quote) ?? sc.decision.criteria[0];
  return (
    <div className="art">
      <div className="art-h">
        <span>Verdict · {Math.round(sc.decision.confidence * 100)}% confidence</span>
        <span className="real">real run</span>
      </div>
      <ul className="art-list">
        {sc.decision.criteria.slice(0, 3).map((c, i) => (
          <li key={i}>
            <span className={c.met ? "art-ok" : "art-no"}>{c.met ? <Check size={13} strokeWidth={3} /> : <X size={13} strokeWidth={2.8} />}</span>
            <span>{c.criterion.length > 110 ? `${c.criterion.slice(0, 108)}…` : c.criterion}</span>
          </li>
        ))}
      </ul>
      {quoted?.quote && <p className="art-quote">&ldquo;{quoted.quote.length > 160 ? `${quoted.quote.slice(0, 158)}…` : quoted.quote}&rdquo;</p>}
      <div className="art-f">
        <span>Recommendation: <b className={sc.decision.recommendation === "pay" ? "art-ok" : "art-no"}>{sc.decision.recommendation}</b> · the vault released it</span>
        <Link href={`/proof/${sc.txHash}`}>receipt →</Link>
      </div>
    </div>
  );
}
