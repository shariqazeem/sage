import { describe, it, expect } from "vitest";
import { judgeDecision } from "./judge-eval";
import { gateFromBrief } from "./autopilot";
import { AUTOPAY_THRESHOLD, isAutoPayQualifying, type DecisionBrief } from "./brain-core";

/**
 * PROOF that P-JUDGE's final classification comes from the SAME production gate the payout pipeline uses
 * — not a copied reimplementation that could drift. `judgeDecision` (used by `runJudgeEval`) must agree
 * with `gateFromBrief` (the pipeline's gate) on every boundary brief, and with `isAutoPayQualifying`
 * (the content bar) for the LLM engine. If someone re-copied the gate logic into the eval and it drifted,
 * these assertions fail.
 */
const CAMPAIGN = { autonomy: "autopilot", autopilotThreshold: 0.85, chainId: 59902 };

const brief = (over: Partial<DecisionBrief>): DecisionBrief => ({
  criteria: [], fraudSignals: [], recommendation: "pay", reasonCode: "all_criteria_met", confidence: 0.95,
  summary: "", engine: "llm", model: "test/model", provider: "api.test", evidenceOk: true,
  contentSha256: null, latencyMs: 1, costUsd: 0, x402PaymentTx: null, ...over,
});

describe("P-JUDGE classification IS the production gate (no copied decision logic)", () => {
  const cases: DecisionBrief[] = [
    brief({}), // pay / 0.95 / clean → autopay
    brief({ confidence: 0.85 }), // exactly at the bar → autopay
    brief({ confidence: 0.849 }), // just under → not
    brief({ recommendation: "review" }),
    brief({ recommendation: "hold" }),
    brief({ fraudSignals: [{ signal: "prompt injection", severity: "high", reason: "x" }] }), // high fraud → not
    brief({ engine: "heuristic", confidence: 1, recommendation: "pay" }), // heuristic can never autopay
  ];
  for (const b of cases) {
    it(`agrees with gateFromBrief: ${b.engine}/${b.recommendation}/${b.confidence}/${b.fraudSignals.length}fraud`, () => {
      const production = gateFromBrief(b, CAMPAIGN, "pending", true).pay;
      const evaled = judgeDecision(b);
      // the eval's autopay decision === the exact pipeline gate
      expect(evaled.autopayQualified).toBe(production);
      expect(evaled.outcome === "autopay").toBe(production);
      // and for an LLM brief the gate === the content bar the pipeline reuses
      if (b.engine === "llm") expect(production).toBe(isAutoPayQualifying(b, AUTOPAY_THRESHOLD));
      else expect(production).toBe(false); // heuristic never autopays, whatever it claims
    });
  }

  it("non-autopay briefs map to review vs hold by the model's own recommendation", () => {
    expect(judgeDecision(brief({ recommendation: "review" })).outcome).toBe("review");
    expect(judgeDecision(brief({ recommendation: "hold" })).outcome).toBe("hold");
    // a sub-threshold 'pay' is not autopay → reads as review (a human should look), never silently paid
    expect(judgeDecision(brief({ confidence: 0.5 })).outcome).toBe("review");
  });
});
