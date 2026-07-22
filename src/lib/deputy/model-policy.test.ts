import { describe, it, expect } from "vitest";
import {
  judgeIdentityGate,
  isApprovedJudgeModel,
  isApprovedJudgeIdentity,
  identityKey,
  AUTOPAY_APPROVED_MODELS,
} from "./model-policy";

/**
 * The autopay-approved judge POLICY-IDENTITY — deterministic pipeline code that an unapproved identity
 * can never bypass, even with a PAY/1.0 brief. An autopay requires the EXACT evaluated (provider, model,
 * prompt, parser) combination: a fallback model, a different provider, or a BUMPED prompt/parser version
 * (a change that was never re-evaluated) all fall to manual review — the gate only ever subtracts.
 */
const APPROVED = {
  provider: "api.commonstack.ai",
  model: "google/gemini-3.1-flash-lite-preview",
  promptVersion: "payout-v1",
  parserVersion: "payout-parse-v2",
};
const brief = (over: Partial<Record<keyof typeof APPROVED, string | null>> = {}) => ({ ...APPROVED, ...over });

describe("autopay-approved judge policy-identity (deterministic, subtract-only)", () => {
  const fallbackModel = "deepseek/deepseek-v4-flash"; // the configured fallback — intentionally NOT approved

  it("approved FULL identity + gate.pay → the existing decision is preserved (pay)", () => {
    expect(judgeIdentityGate(brief(), true)).toEqual({ pay: true, blocked: null, approvedIdentity: true, approvedModel: true });
  });

  it("UNAPPROVED fallback model with a perfect qualifying brief CANNOT pay → manual review", () => {
    const g = judgeIdentityGate(brief({ model: fallbackModel }), true);
    expect(g).toEqual({ pay: false, blocked: "judge_identity_unapproved", approvedIdentity: false, approvedModel: false });
  });

  it("an approved MODEL on a DIFFERENT provider host CANNOT pay (provider is part of the identity)", () => {
    const g = judgeIdentityGate(brief({ provider: "openrouter.ai" }), true);
    expect(g.pay).toBe(false);
    expect(g.blocked).toBe("judge_identity_unapproved");
    expect(g.approvedModel).toBe(true); // the MODEL is on the model allowlist...
    expect(g.approvedIdentity).toBe(false); // ...but this exact combination was never evaluated
  });

  it("a BUMPED PROMPT version CANNOT pay — a prompt change requires re-evaluation before autopay", () => {
    const g = judgeIdentityGate(brief({ promptVersion: "payout-v2" }), true);
    expect(g.pay).toBe(false);
    expect(g.blocked).toBe("judge_identity_unapproved");
    expect(g.approvedIdentity).toBe(false);
  });

  it("a BUMPED PARSER version CANNOT pay — a money-parse change requires re-evaluation before autopay", () => {
    const g = judgeIdentityGate(brief({ parserVersion: "payout-parse-v3" }), true);
    expect(g.pay).toBe(false);
    expect(g.blocked).toBe("judge_identity_unapproved");
    expect(g.approvedIdentity).toBe(false);
  });

  it("MISSING provenance (null model) cannot pay", () => {
    const g = judgeIdentityGate({ ...APPROVED, model: null }, true);
    expect(g.pay).toBe(false);
    expect(g.blocked).toBe("judge_identity_unapproved");
  });

  it("an UNSTAMPED legacy brief (no prompt/parser version) cannot pay → held for review", () => {
    const g = judgeIdentityGate({ provider: APPROVED.provider, model: APPROVED.model, promptVersion: null, parserVersion: null }, true);
    expect(g.pay).toBe(false);
    expect(g.blocked).toBe("judge_identity_unapproved");
  });

  it("NONQUALIFYING results stay hold/review regardless of identity (the gate never CREATES a pay)", () => {
    expect(judgeIdentityGate(brief(), false)).toEqual({ pay: false, blocked: null, approvedIdentity: true, approvedModel: true });
    expect(judgeIdentityGate(brief({ model: fallbackModel }), false)).toEqual({ pay: false, blocked: null, approvedIdentity: false, approvedModel: false });
  });

  it("the model-membership helper is weaker than the identity gate (model in set, but combo unproven)", () => {
    expect(isApprovedJudgeModel(fallbackModel)).toBe(false); // not in the set today
    expect(isApprovedJudgeModel(APPROVED.model)).toBe(true); // an included model passes the weak check
    // ...yet an approved model at a bumped parser is NOT an approved identity:
    expect(isApprovedJudgeIdentity({ ...APPROVED, parserVersion: "payout-parse-v3" })).toBe(false);
  });

  it("the current prod primary FULL identity is approved → NO behavior change for the deployed combination", () => {
    expect(isApprovedJudgeIdentity(APPROVED)).toBe(true);
    expect(AUTOPAY_APPROVED_MODELS.has("google/gemini-3.1-flash-lite-preview")).toBe(true);
  });

  it("identityKey is stable + distinguishes every component", () => {
    expect(identityKey(APPROVED)).toBe("api.commonstack.ai|google/gemini-3.1-flash-lite-preview|payout-v1|payout-parse-v2");
    expect(identityKey({ ...APPROVED, promptVersion: "payout-v2" })).not.toBe(identityKey(APPROVED));
  });
});
