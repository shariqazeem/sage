"use client";

import { useState } from "react";
import { Quote, MousePointer2, Check, X, Lock, ArrowRight } from "lucide-react";

/**
 * REPLAY — the differentiating centerpiece. "Sage doesn't trust the screenshot."
 * A tester's claim sits beside Sage's independent replay in a fresh browser. A truthful,
 * user-controlled toggle shows the TWO possible outcomes — reproduced (payout may
 * continue) or product drift (payout held) — and states plainly that replay is
 * subtractive: it can block a payout but can never approve failed evidence. Nothing
 * here is presented as a specific real transaction; it is a controlled demonstration.
 */
export function SceneReplay() {
  const [drift, setDrift] = useState(false);

  return (
    <section className="rp scene" aria-label="Independent replay">
      <div className="wrap">
        <div className="rp-head">
          <span className="eyebrow">Sage doesn’t trust the screenshot</span>
          <h2 className="h2">Before money moves, Sage performs the action again.</h2>
          <p className="lede rp-lede">
            A tester says the work is done. Sage doesn’t take the claim — or the
            screenshot — on faith. It opens a fresh, isolated browser and does the same
            safe action itself.
          </p>
        </div>

        <div className="rp-grid">
          {/* tester claim */}
          <div className="rp-card rp-claim">
            <div className="rp-card-k mono">
              <span className="rp-role">Tester claimed</span>
            </div>
            <blockquote className="rp-quote">
              <Quote size={18} strokeWidth={1.8} className="rp-quote-ic" />
              Clicked <b>Start</b> and reached the garden.
            </blockquote>
            <div className="rp-claim-foot mono">submitted evidence · 1 screenshot</div>
          </div>

          {/* sage replay */}
          <div className={`rp-card rp-replay${drift ? " is-drift" : ""}`}>
            <div className="rp-card-k mono">
              <span className="rp-role rp-role-sage">Sage replayed</span>
              <span className="rp-fresh mono">
                <Lock size={11} strokeWidth={2.4} /> fresh session
              </span>
            </div>
            <ol className="rp-steps">
              <li className="rp-step done">
                <span className="rp-step-ic ok"><Check size={12} strokeWidth={3} /></span>
                Opened the product in a clean browser
              </li>
              <li className="rp-step done">
                <span className="rp-step-ic ok"><MousePointer2 size={11} strokeWidth={2.6} fill="currentColor" /></span>
                Performed the action: click <b>“Start”</b>
              </li>
              <li className={`rp-step ${drift ? "fail" : "done"}`}>
                <span className={`rp-step-ic ${drift ? "no" : "ok"}`}>
                  {drift ? <X size={12} strokeWidth={3} /> : <Check size={12} strokeWidth={3} />}
                </span>
                {drift ? "Expected state never appeared" : "Observed the garden state"}
              </li>
            </ol>
          </div>
        </div>

        {/* resolution */}
        <div className={`rp-resolve${drift ? " is-drift" : ""}`} role="status" aria-live="polite">
          <div className="rp-resolve-main">
            <span className="rp-resolve-badge">
              {drift ? <X size={15} strokeWidth={2.8} /> : <Check size={15} strokeWidth={3} />}
              {drift ? "Product drift" : "Reproduced"}
            </span>
            <span className="rp-resolve-txt">
              {drift ? (
                <>Outcome didn’t match — <b>payout held</b> for review. No money moves.</>
              ) : (
                <>Outcome matched — <b>payout may continue</b> to the policy-bound wallet.</>
              )}
            </span>
          </div>
          <div className="rp-toggle" role="group" aria-label="Show replay outcome">
            <button type="button" data-on={!drift} onClick={() => setDrift(false)}>
              Reproduced
            </button>
            <button type="button" data-on={drift} onClick={() => setDrift(true)}>
              Product drift
            </button>
          </div>
        </div>

        <p className="rp-note mono">
          <ArrowRight size={13} strokeWidth={2} />
          Replay is subtractive. It can <b>block</b> a payout — it can never turn failed
          evidence into approved evidence.
        </p>
      </div>
    </section>
  );
}
