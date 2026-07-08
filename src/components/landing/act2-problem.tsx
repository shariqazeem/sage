"use client";

import { Check } from "lucide-react";
import { useInView } from "./use-in-view";

const ASKS = [
  "Approve $12 to a vendor?",
  "Approve $40 to a vendor?",
  "Approve $8 to a vendor?",
];

/**
 * ACT 2 — THE PROBLEM, IN MOTION. Three "Approve?" prompts slide in spread apart
 * (the endless permission tax of handing an agent your keys), then collapse and
 * stack into a single card: "Confirm the policy once." Scroll-linked via two
 * IntersectionObserver sentinels (enter → spread, deeper → collapse) + CSS
 * transforms only. Reversible on scroll-up. Under reduced-motion both sentinels
 * report immediately → the resolved single card, fully readable.
 */
export function Act2Problem() {
  const enter = useInView<HTMLSpanElement>({ once: false, threshold: 0.1 });
  const collapse = useInView<HTMLSpanElement>({ once: false, threshold: 0.1 });

  const phase = collapse.inView ? "collapsed" : enter.inView ? "spread" : "hidden";

  return (
    <section className="clx-act clx-act2" aria-label="The problem">
      <span ref={enter.ref} className="clx-sentinel clx-sentinel-a" aria-hidden />
      <span
        ref={collapse.ref}
        className="clx-sentinel clx-sentinel-b"
        aria-hidden
      />

      <div className={`clx-act2-stage phase-${phase}`}>
        <div className="clx-eyebrow clx-mono">The tax of keys</div>

        <div className="clx-act2-cards" aria-hidden={phase === "collapsed"}>
          {ASKS.map((ask, i) => (
            <div key={i} className={`clx-ask slot-${i}`}>
              <span className="clx-ask-q clx-mono">Approve?</span>
              <span className="clx-ask-line">{ask}</span>
              <span className="clx-ask-tick">
                <span />
                <span />
              </span>
            </div>
          ))}
        </div>

        <div className="clx-once" role="note">
          <span className="clx-once-ico">
            <Check size={22} strokeWidth={2.4} />
          </span>
          <h2 className="clx-once-h">Confirm the policy once.</h2>
          <p className="clx-once-p">
            One approval sets the budget, the recipients, and the rule. After that
            the Deputy works inside it — no more prompts, no more keys.
          </p>
        </div>
      </div>
    </section>
  );
}
