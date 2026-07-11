import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeputyAssessmentCard } from "./deputy-assessment";
import type { DecisionBrief } from "@/lib/deputy/brain-core";

function makeBrief(over: Partial<DecisionBrief> = {}): DecisionBrief {
  return {
    engine: "llm",
    model: "deepseek/deepseek-v4-flash",
    provider: "api.commonstack.ai",
    criteria: [],
    fraudSignals: [],
    recommendation: "pay",
    reasonCode: "all_criteria_met",
    confidence: 0.92,
    summary: "Clean, evidenced work.",
    evidenceOk: true,
    contentSha256: "abcd1234ef567890beef000011112222",
    latencyMs: 1400,
    costUsd: 0.0003,
    x402PaymentTx: null,
    ...over,
  };
}

describe("DeputyAssessmentCard — forensic receipt states", () => {
  it("shows the machine-state verdict word + 'autopay bar' microcopy when the bar is cleared", () => {
    render(<DeputyAssessmentCard brief={makeBrief({ confidence: 0.92, recommendation: "pay" })} threshold={0.85} />);
    expect(screen.getByText("PAY")).toBeInTheDocument();
    expect(screen.getByText(/92% ≥ 85% autopay bar/)).toBeInTheDocument();
  });

  it("shows 'held for human review' when confidence is below the bar", () => {
    render(<DeputyAssessmentCard brief={makeBrief({ confidence: 0.62, recommendation: "review" })} threshold={0.85} />);
    expect(screen.getByText("REVIEW")).toBeInTheDocument();
    expect(screen.getByText(/62% < 85% — held for human review/)).toBeInTheDocument();
  });

  it("renders the ATTACK strip (with pattern families) ONLY for a high-severity injection signal", () => {
    const brief = makeBrief({
      recommendation: "hold",
      confidence: 0.4,
      fraudSignals: [
        {
          signal: "prompt injection",
          severity: "high",
          reason:
            "untrusted submission content contains instruction-like patterns (override-instructions, instruct-verdict) — treated as an attack",
        },
      ],
    });
    render(<DeputyAssessmentCard brief={brief} threshold={0.85} />);
    expect(screen.getByText(/Attack detected/i)).toBeInTheDocument();
    expect(screen.getByText(/override-instructions, instruct-verdict/)).toBeInTheDocument();
  });

  it("does NOT render the ATTACK strip for a non-injection fraud signal", () => {
    const brief = makeBrief({
      recommendation: "hold",
      fraudSignals: [{ signal: "spam", severity: "high", reason: "templated note" }],
    });
    render(<DeputyAssessmentCard brief={brief} threshold={0.85} />);
    expect(screen.queryByText(/Attack detected/i)).toBeNull();
  });

  it("renders the provenance microline with model, reasonCode, and a shortened sha", () => {
    render(<DeputyAssessmentCard brief={makeBrief()} threshold={0.85} />);
    expect(screen.getByText(/sha256 abcd1234…11112222/)).toBeInTheDocument();
    expect(screen.getByText(/all_criteria_met/)).toBeInTheDocument();
  });
});
