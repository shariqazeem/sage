"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, Wand2, ShieldCheck, Check, X, MousePointer2, Lock } from "lucide-react";

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
];

export function SceneWorkflow() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const i = refs.current.indexOf(e.target as HTMLDivElement);
            if (i >= 0) setActive(i);
          }
        }
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    refs.current.forEach((r) => r && io.observe(r));
    return () => io.disconnect();
  }, []);

  return (
    <section id="how" className="wf scene" aria-label="How Sage works">
      <div className="wrap">
        <div className="wf-head">
          <span className="eyebrow">One URL becomes a campaign</span>
          <h2 className="h2">You watch the agent work — see, design, then verify.</h2>
        </div>

        <div className="wf-grid">
          <div className="wf-stage-col">
            <div className="wf-stage" data-active={active}>
              <WfVisual active={active} />
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
                  <WfVisual active={i} />
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
