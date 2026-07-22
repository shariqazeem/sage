import { describe, it, expect, afterEach } from "vitest";
import {
  judgeIdentityGate,
  isApprovedJudgeModel,
  isApprovedJudgeIdentity,
  identityKey,
  CANDIDATE_IDENTITIES,
  AUTOPAY_APPROVED_MODELS,
  __approveForTest,
  __clearTestApprovals,
} from "./model-policy";

/**
 * The autopay policy-identity registry (Gate C item 3). CANDIDATE and APPROVED are separate: the
 * production approved registry is EMPTY until a clean promotion, so nothing self-approves. Tests inject an
 * approved identity EXPLICITLY (a deliberate registration), never relying on a shipped default. An autopay
 * requires the exact evaluated (provider, model, prompt, parser) combination; the gate only subtracts.
 */
const APPROVED = {
  provider: "api.commonstack.ai",
  model: "google/gemini-3.1-flash-lite-preview",
  promptVersion: "payout-v1",
  parserVersion: "payout-parse-v3",
};
const brief = (over: Partial<Record<keyof typeof APPROVED, string | null>> = {}) => ({ ...APPROVED, ...over });

afterEach(() => __clearTestApprovals());

describe("candidate vs approved — nothing self-approves", () => {
  it("the production approved registry is EMPTY → the candidate identity CANNOT pay by default", () => {
    const g = judgeIdentityGate(brief(), true); // no approval registered
    expect(g.pay).toBe(false);
    expect(g.blocked).toBe("judge_identity_unapproved");
    expect(isApprovedJudgeIdentity(APPROVED)).toBe(false);
  });

  it("payout-parse-v3 is a CANDIDATE, not an approved identity", () => {
    expect(CANDIDATE_IDENTITIES.some((c) => c.parserVersion === "payout-parse-v3")).toBe(true);
    expect(isApprovedJudgeIdentity(APPROVED)).toBe(false); // present as a candidate, but not approved
  });

  it("environment variables cannot bless an identity (approval is code-only)", () => {
    process.env.FAKE_APPROVE = "api.commonstack.ai|google/gemini-3.1-flash-lite-preview|payout-v1|payout-parse-v3";
    expect(isApprovedJudgeIdentity(APPROVED)).toBe(false);
    delete process.env.FAKE_APPROVE;
  });

  it("a qualifying brief on an unapproved identity would safely produce manual review (held)", () => {
    // gate.pay true (all prior gates passed) but the identity is unapproved → the gate blocks the payout.
    expect(judgeIdentityGate(brief(), true).blocked).toBe("judge_identity_unapproved");
  });
});

describe("an EXPLICITLY test-approved identity behaves like a promoted one", () => {
  const register = () => __approveForTest(APPROVED);

  it("approved full identity + gate.pay → pay", () => {
    register();
    expect(judgeIdentityGate(brief(), true)).toEqual({ pay: true, blocked: null, approvedIdentity: true, approvedModel: true });
  });

  it("a DIFFERENT provider / bumped prompt / bumped parser / fallback model → still blocked", () => {
    register();
    for (const over of [{ provider: "openrouter.ai" }, { promptVersion: "payout-v2" }, { parserVersion: "payout-parse-v4" }, { model: "deepseek/deepseek-v4-flash" }]) {
      const g = judgeIdentityGate(brief(over), true);
      expect(g.pay, JSON.stringify(over)).toBe(false);
      expect(g.blocked, JSON.stringify(over)).toBe("judge_identity_unapproved");
    }
  });

  it("null model / unstamped legacy brief → blocked even when an identity is approved", () => {
    register();
    expect(judgeIdentityGate({ ...APPROVED, model: null }, true).blocked).toBe("judge_identity_unapproved");
    expect(judgeIdentityGate({ provider: APPROVED.provider, model: APPROVED.model, promptVersion: null, parserVersion: null }, true).blocked).toBe("judge_identity_unapproved");
  });

  it("NONQUALIFYING (gate.pay false) never creates a pay", () => {
    register();
    expect(judgeIdentityGate(brief(), false)).toEqual({ pay: false, blocked: null, approvedIdentity: true, approvedModel: true });
  });

  it("clearing test approvals reverts to unapproved (no leak between tests)", () => {
    register();
    expect(isApprovedJudgeIdentity(APPROVED)).toBe(true);
    __clearTestApprovals();
    expect(isApprovedJudgeIdentity(APPROVED)).toBe(false);
  });
});

describe("model-membership helper (informational, weaker than the identity gate)", () => {
  it("known candidate models pass the weak check; unknown fail", () => {
    expect(isApprovedJudgeModel("google/gemini-3.1-flash-lite-preview")).toBe(true);
    expect(isApprovedJudgeModel("anthropic/claude-haiku-4-5")).toBe(true);
    expect(isApprovedJudgeModel("deepseek/deepseek-v4-flash")).toBe(false);
    expect(isApprovedJudgeModel(null)).toBe(false);
    expect(AUTOPAY_APPROVED_MODELS.has("google/gemini-3.1-flash-lite-preview")).toBe(true);
  });

  it("identityKey is stable and distinguishes every component", () => {
    expect(identityKey(APPROVED)).toBe("api.commonstack.ai|google/gemini-3.1-flash-lite-preview|payout-v1|payout-parse-v3");
    expect(identityKey({ ...APPROVED, parserVersion: "payout-parse-v4" })).not.toBe(identityKey(APPROVED));
  });
});
