import { describe, it, expect } from "vitest";
import { judgeModelGate, isApprovedJudgeModel, AUTOPAY_APPROVED_MODELS } from "./model-policy";

/**
 * The autopay-approved judge-model policy — deterministic pipeline code that an unapproved model can
 * never bypass, even with a PAY/1.0 brief. Covers GPT-review's required cases.
 */
describe("autopay-approved judge-model policy (deterministic, subtract-only)", () => {
  const approved = [...AUTOPAY_APPROVED_MODELS][0]; // a known-approved model
  const fallbackModel = "deepseek/deepseek-v4-flash"; // the configured fallback — intentionally NOT approved

  it("approved primary + gate.pay → the existing decision is preserved (pay)", () => {
    expect(judgeModelGate({ model: approved }, true)).toEqual({ pay: true, blocked: null, approvedModel: true });
  });

  it("UNAPPROVED fallback with a perfect qualifying brief CANNOT pay → manual review", () => {
    expect(judgeModelGate({ model: fallbackModel }, true)).toEqual({ pay: false, blocked: "judge_model_unapproved", approvedModel: false });
  });

  it("MISSING provenance (null model) cannot pay", () => {
    const g = judgeModelGate({ model: null }, true);
    expect(g.pay).toBe(false);
    expect(g.blocked).toBe("judge_model_unapproved");
  });

  it("UNKNOWN / alias-resolved-elsewhere model cannot pay", () => {
    expect(judgeModelGate({ model: "someone/unknown-model-9000" }, true).pay).toBe(false);
  });

  it("an approved FALLBACK becomes eligible only after EXPLICIT policy inclusion", () => {
    expect(isApprovedJudgeModel(fallbackModel)).toBe(false); // not in the set today
    expect(isApprovedJudgeModel(approved)).toBe(true); // an included model passes — inclusion is the gate
  });

  it("NONQUALIFYING results stay hold/review regardless of model approval (the gate never CREATES a pay)", () => {
    expect(judgeModelGate({ model: approved }, false)).toEqual({ pay: false, blocked: null, approvedModel: true });
    expect(judgeModelGate({ model: fallbackModel }, false)).toEqual({ pay: false, blocked: null, approvedModel: false });
  });

  it("the current prod primary is approved → NO behavior change for the deployed model", () => {
    expect(isApprovedJudgeModel("google/gemini-3.1-flash-lite-preview")).toBe(true);
  });
});
