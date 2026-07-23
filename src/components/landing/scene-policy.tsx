import { Lock, Check } from "lucide-react";
import { usd } from "@/lib/format";
import { Reveal } from "./reveal";

/**
 * POLICY — "The wallet has rules." The founder approves once; after that the budget,
 * mission rules, verification policy and payout limits are fixed on-chain and the agent
 * cannot rewrite them. The panel lists the real constraint shape in human terms; the
 * live per-tx cap is shown when the chain read succeeds, never fabricated.
 */
export function ScenePolicy({ perTxCap }: { perTxCap: number | null }) {
  return (
    <section className="pol scene" aria-label="Policy-bound money">
      <div className="wrap pol-grid">
        <Reveal className="reveal pol-copy">
          <span className="eyebrow">The wallet has rules</span>
          <h2 className="h2">Even Sage cannot move money outside the approved plan.</h2>
          <p className="lede pol-lede">
            The founder approves the plan once. After that, Sage can operate autonomously —
            but the budget, mission rules, verification policy, and payout limits cannot be
            rewritten by the agent.
          </p>
          <p className="pol-sub mono">
            The AI proposes. The vault disposes. A model output is only a recommendation;
            the on-chain policy computes the amount and can refuse.
          </p>
        </Reveal>

        <Reveal className="reveal pol-panel-wrap" threshold={0.2}>
          <div className="pol-panel">
            <div className="pol-panel-h">
              <span className="pol-panel-ic"><Lock size={15} strokeWidth={2} /></span>
              <span>Policy-bound wallet</span>
              <span className="pol-panel-tag mono">founder-approved</span>
            </div>
            <ul className="pol-rules">
              <li>
                <span className="pol-rule-k mono">Budget approved</span>
                <span className="pol-rule-v mono">by the founder</span>
              </li>
              <li>
                <span className="pol-rule-k mono">Per-payment cap</span>
                <span className="pol-rule-v mono">{perTxCap != null ? usd(perTxCap) : "set on-chain"}</span>
              </li>
              <li>
                <span className="pol-rule-k mono">Mission reward &amp; completions</span>
                <span className="pol-rule-v mono">fixed per mission</span>
              </li>
              <li>
                <span className="pol-rule-k mono">Verification policy</span>
                <span className="pol-rule-v mono">digest-bound</span>
              </li>
            </ul>
            <div className="pol-gate">
              <div className="pol-gate-h mono">Settlement opens only when</div>
              <div className="pol-gate-list">
                <span className="pol-sig"><Check size={12} strokeWidth={3} /> replay reproduced</span>
                <span className="pol-sig"><Check size={12} strokeWidth={3} /> within budget</span>
                <span className="pol-sig"><Check size={12} strokeWidth={3} /> within caps</span>
                <span className="pol-sig"><Check size={12} strokeWidth={3} /> policy digest matches</span>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
