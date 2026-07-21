"use client";

import { Check } from "lucide-react";
import { useInView } from "./use-in-view";

const ASKS = [
  "Approve $12 to a vendor?",
  "Approve $40 to a vendor?",
  "Approve $8 to a vendor?",
];

/**
 * ACT 2 — THE PROBLEM → THE RESOLUTION. P24: was a 2-viewport sticky-scroll
 * choreography whose sticky stage un-stuck partway, leaving a full blank viewport of
 * dead scroll. Rebuilt as a single normal-flow section that reveals ONCE on enter (no
 * sticky runway → no dead zone): the three endless "Approve?" prompts (the tax of
 * handing an agent your keys), then the one card that resolves them. Staggered reveal
 * from the motion vocabulary; under reduced-motion the tokens zero out → it's just
 * there, fully readable.
 */
export function Act2Problem() {
  const { ref, inView } = useInView<HTMLDivElement>({ once: true, threshold: 0.2 });

  return (
    <section className="clx-act clx-act2" aria-label="The problem">
      <div ref={ref} className={`clx-act2-stage${inView ? " in" : ""}`}>
        <div className="clx-eyebrow clx-mono">The tax of keys</div>

        <div className="clx-act2-cards">
          {ASKS.map((ask, i) => (
            <div key={i} className="clx-ask" style={{ ["--i" as string]: i }}>
              <span className="clx-ask-q clx-mono">Approve?</span>
              <span className="clx-ask-line">{ask}</span>
              <span className="clx-ask-tick">
                <span />
                <span />
              </span>
            </div>
          ))}
        </div>

        <div className="clx-once" role="note" style={{ ["--i" as string]: 3 }}>
          <span className="clx-once-ico">
            <Check size={22} strokeWidth={2.4} />
          </span>
          <h2 className="clx-once-h">Set the limits once.</h2>
          <p className="clx-once-p">
            One setup fixes the budget, the recipients, and the limits. After that
            Sage works inside its wallet — no more prompts, no more keys.
          </p>
        </div>
      </div>
    </section>
  );
}
