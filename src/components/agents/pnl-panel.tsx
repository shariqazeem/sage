import { ArrowDownRight, ArrowUpRight, Cpu } from "lucide-react";

export interface PnLView {
  earnedFeesUsd: number;
  verificationCount: number;
  verificationSpentUsd: number;
  llmDecisions: number;
  llmSpentUsd: number;
}

const money = (n: number) =>
  n === 0 ? "$0.00" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;

/**
 * The Deputy's P&L — every number summed from real rows (sandbox excluded).
 * EARNED is operator fees actually collected; SPENT is the Deputy paying for its
 * own inputs (x402 verification + LLM inference). Zeros render honestly.
 * Presentational + token-only, so it works on /agents and the app's Proof tab.
 */
export function PnLPanel({ pnl }: { pnl: PnLView }) {
  return (
    <div className="sage-pnl">
      <div className="sage-pnl-row">
        <span className="sage-pnl-k earned">
          <ArrowDownRight size={13} /> EARNED · operator fees
        </span>
        <span className="sage-pnl-v earned mono">{money(pnl.earnedFeesUsd)}</span>
      </div>
      <div className="sage-pnl-row">
        <span className="sage-pnl-k">
          <ArrowUpRight size={13} /> SPENT · verification (x402)
        </span>
        <span className="sage-pnl-v mono">
          {money(pnl.verificationSpentUsd)}
          <i className="sage-pnl-note">0.1 × {pnl.verificationCount}</i>
        </span>
      </div>
      <div className="sage-pnl-row">
        <span className="sage-pnl-k">
          <Cpu size={13} /> SPENT · LLM inference
        </span>
        <span className="sage-pnl-v mono">
          {money(pnl.llmSpentUsd)}
          <i className="sage-pnl-note">
            {pnl.llmDecisions} decision{pnl.llmDecisions === 1 ? "" : "s"}
          </i>
        </span>
      </div>
    </div>
  );
}
