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
 * The autopay policy-identity registry (Gate C item 3). CANDIDATE and APPROVED are separate. Since
 * 2026-08-25 the production registry holds exactly ONE promoted identity (MiniMax-M3 — see
 * docs/deputy-promotions/2026-08-25-minimax-m3.md); every other combination, including the
 * commonstack-haiku CANDIDATE below, still cannot pay. Tests that need an approved identity inject
 * one EXPLICITLY (a deliberate registration), never relying on a shipped default.
 */
const CANDIDATE = {
  provider: "api.commonstack.ai",
  model: "anthropic/claude-haiku-4-5",
  promptVersion: "payout-v1",
  parserVersion: "payout-parse-v4",
};
const PROMOTED = {
  provider: "api.minimax.io",
  model: "MiniMax-M3",
  promptVersion: "payout-v1",
  parserVersion: "payout-parse-v4",
};
const brief = (over: Partial<Record<keyof typeof CANDIDATE, string | null>> = {}) => ({ ...CANDIDATE, ...over });

afterEach(() => __clearTestApprovals());

describe("candidate vs approved — nothing self-approves", () => {
  it("a CANDIDATE identity CANNOT pay by default — only the explicit registry approves", () => {
    const g = judgeIdentityGate(brief(), true); // haiku@commonstack: candidate, never registered
    expect(g.pay).toBe(false);
    expect(g.blocked).toBe("judge_identity_unapproved");
    expect(isApprovedJudgeIdentity(CANDIDATE)).toBe(false);
  });

  it("payout-parse-v4 haiku is a CANDIDATE, not an approved identity", () => {
    expect(CANDIDATE_IDENTITIES.some((c) => c.parserVersion === "payout-parse-v4" && c.model === "anthropic/claude-haiku-4-5")).toBe(true);
    expect(isApprovedJudgeIdentity(CANDIDATE)).toBe(false); // present as a candidate, but not approved
  });

  it("THE PROMOTED IDENTITY (2026-08-25): MiniMax-M3 @ api.minimax.io on payout-v1/parse-v4 pays; nothing near it does", () => {
    expect(isApprovedJudgeIdentity(PROMOTED)).toBe(true);
    expect(judgeIdentityGate(PROMOTED, true)).toEqual({ pay: true, blocked: null, approvedIdentity: true, approvedModel: true });
    // the same model through ANY other door stays blocked — provider, prompt, or parser drift kills it.
    for (const over of [{ provider: "api.commonstack.ai" }, { promptVersion: "payout-v2" }, { parserVersion: "payout-parse-v3" }]) {
      expect(judgeIdentityGate({ ...PROMOTED, ...over }, true).blocked, JSON.stringify(over)).toBe("judge_identity_unapproved");
    }
  });

  it("environment variables cannot bless an identity (approval is code-only)", () => {
    process.env.FAKE_APPROVE = "api.commonstack.ai|anthropic/claude-haiku-4-5|payout-v1|payout-parse-v4";
    expect(isApprovedJudgeIdentity(CANDIDATE)).toBe(false);
    delete process.env.FAKE_APPROVE;
  });

  it("a qualifying brief on an unapproved identity would safely produce manual review (held)", () => {
    // gate.pay true (all prior gates passed) but the identity is unapproved → the gate blocks the payout.
    expect(judgeIdentityGate(brief(), true).blocked).toBe("judge_identity_unapproved");
  });
});

describe("an EXPLICITLY test-approved identity behaves like a promoted one", () => {
  const register = () => __approveForTest(CANDIDATE);

  it("approved full identity + gate.pay → pay", () => {
    register();
    expect(judgeIdentityGate(brief(), true)).toEqual({ pay: true, blocked: null, approvedIdentity: true, approvedModel: true });
  });

  it("a DIFFERENT provider / bumped prompt / bumped parser / fallback model → still blocked", () => {
    register();
    for (const over of [{ provider: "openrouter.ai" }, { promptVersion: "payout-v2" }, { parserVersion: "payout-parse-v3" }, { model: "deepseek/deepseek-v4-flash" }]) {
      const g = judgeIdentityGate(brief(over), true);
      expect(g.pay, JSON.stringify(over)).toBe(false);
      expect(g.blocked, JSON.stringify(over)).toBe("judge_identity_unapproved");
    }
  });

  it("null model / unstamped legacy brief → blocked even when an identity is approved", () => {
    register();
    expect(judgeIdentityGate({ ...CANDIDATE, model: null }, true).blocked).toBe("judge_identity_unapproved");
    expect(judgeIdentityGate({ provider: CANDIDATE.provider, model: CANDIDATE.model, promptVersion: null, parserVersion: null }, true).blocked).toBe("judge_identity_unapproved");
  });

  it("NONQUALIFYING (gate.pay false) never creates a pay", () => {
    register();
    expect(judgeIdentityGate(brief(), false)).toEqual({ pay: false, blocked: null, approvedIdentity: true, approvedModel: true });
  });

  it("clearing test approvals reverts to unapproved (no leak between tests)", () => {
    register();
    expect(isApprovedJudgeIdentity(CANDIDATE)).toBe(true);
    __clearTestApprovals();
    expect(isApprovedJudgeIdentity(CANDIDATE)).toBe(false);
  });
});

describe("model-membership helper (informational, weaker than the identity gate)", () => {
  it("known candidate/approved models pass the weak check; retired and unknown fail", () => {
    expect(isApprovedJudgeModel("anthropic/claude-haiku-4-5")).toBe(true);
    expect(isApprovedJudgeModel("MiniMax-M3")).toBe(true);
    expect(isApprovedJudgeModel("google/gemini-3.1-flash-lite-preview")).toBe(false); // retired candidate
    expect(isApprovedJudgeModel("deepseek/deepseek-v4-flash")).toBe(false);
    expect(isApprovedJudgeModel(null)).toBe(false);
    expect(AUTOPAY_APPROVED_MODELS.has("MiniMax-M3")).toBe(true);
  });

  it("identityKey is stable and distinguishes every component", () => {
    expect(identityKey(CANDIDATE)).toBe("api.commonstack.ai|anthropic/claude-haiku-4-5|payout-v1|payout-parse-v4");
    expect(identityKey({ ...CANDIDATE, parserVersion: "payout-parse-v3" })).not.toBe(identityKey(CANDIDATE));
  });
});
