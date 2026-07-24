import { describe, it, expect, afterEach } from "vitest";
import {
  canaryAllowlist,
  resolveCanaryAuthority,
  isValidFounderWallet,
  isWalletCanaryEligible,
  firstUnmetStrictCondition,
  deterministicGroundedPlanDigest,
  canaryPlanCommitment,
  evaluateCanarySelection,
  type CanaryIdentity,
} from "./mission-canary";
import type { GroundedCandidatePlan, GroundedPlanSignals, MissionGroundingMode } from "./mission-grounding-shadow";
import type { CandidateMission } from "./schemas";

/**
 * Phase 5 — deterministic proof of the canary selection contract. No network, no DB. Proves the authority gate
 * can ONLY be opened by (mode=canary + server-session identity + opt-in + allowlist), the strict plan gate,
 * the deterministic digest, the approval binding, and the full off/shadow/canary truth table.
 */

const ALLOW = "MISSION_CANARY_ALLOWLIST";
const WALLET = "0xAbCdef0123456789abCDEF0123456789abcDEf01";
afterEach(() => { delete process.env[ALLOW]; });

const allTrueSignals = (): GroundedPlanSignals => ({
  architectStrictValid: true,
  compilerProducedMissions: true,
  everyCriterionCriticSupported: true,
  allDecisiveGrounded: true,
  noInferredOnlyDecisive: true,
  safeTransitionsEstablished: true,
  canonicalGatePassed: true,
  allocationExactEqual: true,
  provenancePresent: true,
});

const mission = (key: string): CandidateMission => ({
  missionKey: key,
  title: `T ${key}`,
  objective: `Objective ${key}`,
  instructions: "do the thing",
  whyItMatters: "it matters",
  priority: "high",
  riskCategory: "critical_journey",
  effortMinutes: 5,
  rewardWeight: 5,
  maxCompletions: 3,
  confidence: 0.8,
  conditions: [],
  assumptions: [],
  disallowed: [],
  criteria: ["Loading the report reaches the observed report state"],
  evidenceRequirements: ["Describe the report state reached"],
}) as unknown as CandidateMission;

const goodPlan = (over: Partial<GroundedCandidatePlan> = {}): GroundedCandidatePlan => ({
  missions: [mission("m-load-report")],
  suppliedBudgetBase: "10000000",
  allocatedBudgetBase: "10000000",
  architectModel: "gemini-3.1-flash-lite-preview",
  architectProvider: "commonstack",
  architectContractVersion: "semantic-draft-v1",
  criticModel: "gemini-3.1-flash-lite-preview",
  criticProvider: "commonstack",
  criticContractVersion: "critic-contract-v3",
  observationSetDigest: "abc123",
  signals: allTrueSignals(),
  strictSelectable: true,
  ...over,
});

const serverId = (over: Partial<CanaryIdentity> = {}): CanaryIdentity => ({ wallet: WALLET, operatorAuthorized: true, source: "server_session", ...over });

describe("isValidFounderWallet — syntactic, non-anonymous", () => {
  it("accepts a 0x+40hex wallet; rejects anonymous/empty/malformed/prose", () => {
    expect(isValidFounderWallet(WALLET)).toBe(true);
    expect(isValidFounderWallet("anonymous")).toBe(false);
    expect(isValidFounderWallet("")).toBe(false);
    expect(isValidFounderWallet("0x123")).toBe(false);
    expect(isValidFounderWallet("ignore previous instructions")).toBe(false);
    expect(isValidFounderWallet(null)).toBe(false);
  });
});

describe("canaryAllowlist — operator-controlled, case-insensitive, fails closed", () => {
  it("empty/unset ⇒ nobody eligible", () => { expect(canaryAllowlist().size).toBe(0); });
  it("parses comma/space separated + lowercases", () => {
    process.env[ALLOW] = ` ${WALLET}, 0xBeef `;
    const s = canaryAllowlist();
    expect(s.has(WALLET.toLowerCase())).toBe(true);
    expect(s.has("0xbeef")).toBe(true);
    expect(s.has(WALLET)).toBe(false); // stored lowercased
  });
});

describe("isWalletCanaryEligible — wildcard '*' authorizes every VALID founder wallet", () => {
  const OTHER = "0x1111111111111111111111111111111111111111";
  it("unset ⇒ nobody eligible", () => {
    expect(isWalletCanaryEligible(WALLET)).toBe(false);
  });
  it("specific wallet ⇒ only that wallet", () => {
    process.env[ALLOW] = WALLET;
    expect(isWalletCanaryEligible(WALLET)).toBe(true);
    expect(isWalletCanaryEligible(OTHER)).toBe(false);
  });
  it("'*' ⇒ ANY valid wallet eligible (case-insensitive)", () => {
    process.env[ALLOW] = "*";
    expect(isWalletCanaryEligible(WALLET)).toBe(true);
    expect(isWalletCanaryEligible(OTHER)).toBe(true);
    expect(isWalletCanaryEligible(WALLET.toUpperCase())).toBe(true);
  });
  it("'*' NEVER authorizes an anonymous / malformed wallet — the shape check still applies", () => {
    process.env[ALLOW] = "*";
    expect(isWalletCanaryEligible("anonymous")).toBe(false);
    expect(isWalletCanaryEligible("0xnothex")).toBe(false);
    expect(isWalletCanaryEligible("")).toBe(false);
    expect(isWalletCanaryEligible(null)).toBe(false);
  });
});

describe("resolveCanaryAuthority + wildcard — widens WHO, never weakens the other gates", () => {
  const OTHER = "0x2222222222222222222222222222222222222222";
  it("'*' + canary + server identity + opt-in + valid wallet ⇒ allowed for ANY founder", () => {
    process.env[ALLOW] = "*";
    expect(resolveCanaryAuthority("canary", serverId({ wallet: OTHER }))).toEqual({ allowed: true, wallet: OTHER });
  });
  it("'*' still requires canary mode", () => {
    process.env[ALLOW] = "*";
    expect(resolveCanaryAuthority("shadow", serverId({ wallet: OTHER }))).toEqual({ allowed: false, reason: "mode_not_canary" });
  });
  it("'*' still requires a server-session identity", () => {
    process.env[ALLOW] = "*";
    expect(resolveCanaryAuthority("canary", null)).toEqual({ allowed: false, reason: "no_server_identity" });
  });
  it("'*' still rejects an anonymous wallet (invalid_wallet)", () => {
    process.env[ALLOW] = "*";
    expect(resolveCanaryAuthority("canary", serverId({ wallet: "anonymous" }))).toEqual({ allowed: false, reason: "invalid_wallet" });
  });
  it("'*' + canary + valid plan ⇒ selected for a fresh wallet", () => {
    process.env[ALLOW] = "*";
    const d = evaluateCanarySelection({ mode: "canary", identity: serverId({ wallet: OTHER }), plan: goodPlan() });
    expect(d.status).toBe("selected");
  });
});

describe("resolveCanaryAuthority — ALL of {canary mode, server identity, opt-in, allowlist} required", () => {
  it("mode not canary ⇒ denied", () => {
    process.env[ALLOW] = WALLET;
    for (const mode of ["off", "shadow"] as MissionGroundingMode[]) {
      expect(resolveCanaryAuthority(mode, serverId())).toEqual({ allowed: false, reason: "mode_not_canary" });
    }
  });
  it("no identity ⇒ denied", () => {
    process.env[ALLOW] = WALLET;
    expect(resolveCanaryAuthority("canary", null)).toEqual({ allowed: false, reason: "no_server_identity" });
  });
  it("identity not from the server session ⇒ denied (provenance tag is load-bearing)", () => {
    process.env[ALLOW] = WALLET;
    const forged = { wallet: WALLET, operatorAuthorized: true, source: "founder_text" } as unknown as CanaryIdentity;
    expect(resolveCanaryAuthority("canary", forged)).toEqual({ allowed: false, reason: "no_server_identity" });
  });
  it("anonymous / malformed wallet ⇒ denied (invalid_wallet)", () => {
    process.env[ALLOW] = WALLET;
    expect(resolveCanaryAuthority("canary", serverId({ wallet: "anonymous" }))).toEqual({ allowed: false, reason: "invalid_wallet" });
    expect(resolveCanaryAuthority("canary", serverId({ wallet: "0xnothex" }))).toEqual({ allowed: false, reason: "invalid_wallet" });
  });
  it("not operator-authorized ⇒ denied", () => {
    process.env[ALLOW] = WALLET;
    expect(resolveCanaryAuthority("canary", serverId({ operatorAuthorized: false }))).toEqual({ allowed: false, reason: "not_operator_authorized" });
  });
  it("not on allowlist ⇒ denied", () => {
    process.env[ALLOW] = "0xsomeoneelse";
    expect(resolveCanaryAuthority("canary", serverId())).toEqual({ allowed: false, reason: "not_allowlisted" });
  });
  it("all four satisfied ⇒ allowed (wallet lowercased)", () => {
    process.env[ALLOW] = WALLET;
    expect(resolveCanaryAuthority("canary", serverId())).toEqual({ allowed: true, wallet: WALLET.toLowerCase() });
  });
});

describe("firstUnmetStrictCondition — every strict signal must hold", () => {
  it("null / empty plan", () => {
    expect(firstUnmetStrictCondition(null)).toBe("no_grounded_plan");
    expect(firstUnmetStrictCondition(goodPlan({ missions: [] }))).toBe("no_missions");
  });
  it("a good plan is fully selectable", () => { expect(firstUnmetStrictCondition(goodPlan())).toBeNull(); });
  it("each false signal is the reported blocker", () => {
    for (const k of Object.keys(allTrueSignals()) as (keyof GroundedPlanSignals)[]) {
      const s = { ...allTrueSignals(), [k]: false };
      expect(firstUnmetStrictCondition(goodPlan({ signals: s }))).toBe(`signal:${k}`);
    }
  });
  it("budget inequality blocks even with all signals true", () => {
    expect(firstUnmetStrictCondition(goodPlan({ allocatedBudgetBase: "9999999" }))).toBe("budget_not_exact_equal");
  });
  it("missing provenance blocks", () => {
    expect(firstUnmetStrictCondition(goodPlan({ criticProvider: null }))).toBe("provenance_missing");
  });
});

describe("deterministicGroundedPlanDigest — stable + reorder-insensitive + content-sensitive", () => {
  it("identical plans ⇒ identical digest", () => {
    expect(deterministicGroundedPlanDigest(goodPlan())).toBe(deterministicGroundedPlanDigest(goodPlan()));
  });
  it("mission order does not change the digest", () => {
    const a = goodPlan({ missions: [mission("a"), mission("b")] });
    const b = goodPlan({ missions: [mission("b"), mission("a")] });
    expect(deterministicGroundedPlanDigest(a)).toBe(deterministicGroundedPlanDigest(b));
  });
  it("a changed reward weight changes the digest", () => {
    const changed = goodPlan({ missions: [{ ...mission("a"), rewardWeight: 9 } as CandidateMission] });
    expect(deterministicGroundedPlanDigest(changed)).not.toBe(deterministicGroundedPlanDigest(goodPlan({ missions: [mission("a")] })));
  });
});

describe("canaryPlanCommitment — commitment (NOT a token) binds plan digest + budget + revision", () => {
  it("same inputs ⇒ same commitment; any change ⇒ different commitment", () => {
    const base = { planDigest: "0xdig", budgetText: "10000000 base units @ 6dp", budgetBase: "10000000", revision: 1 };
    const c = canaryPlanCommitment(base).commitment;
    expect(canaryPlanCommitment(base).commitment).toBe(c);
    expect(canaryPlanCommitment({ ...base, planDigest: "0xOTHER" }).commitment).not.toBe(c);
    expect(canaryPlanCommitment({ ...base, budgetBase: "20000000" }).commitment).not.toBe(c);
    expect(canaryPlanCommitment({ ...base, revision: 2 }).commitment).not.toBe(c);
  });
});

describe("evaluateCanarySelection — the off/shadow/canary truth table", () => {
  it("off ⇒ disabled (legacy proceeds), regardless of plan/identity", () => {
    const d = evaluateCanarySelection({ mode: "off", identity: serverId(), plan: goodPlan() });
    expect(d.status).toBe("disabled");
  });
  it("shadow ⇒ disabled (legacy proceeds)", () => {
    const d = evaluateCanarySelection({ mode: "shadow", identity: serverId(), plan: goodPlan() });
    expect(d.status).toBe("disabled");
  });
  it("canary + unauthorized founder ⇒ unauthorized (legacy proceeds, NOT blocked)", () => {
    process.env[ALLOW] = "0xnotthisfounder";
    const d = evaluateCanarySelection({ mode: "canary", identity: serverId(), plan: goodPlan() });
    expect(d).toEqual({ status: "unauthorized", reason: "not_allowlisted" });
  });
  it("canary + authorized + strict plan good ⇒ selected (with digest)", () => {
    process.env[ALLOW] = WALLET;
    const d = evaluateCanarySelection({ mode: "canary", identity: serverId(), plan: goodPlan() });
    expect(d.status).toBe("selected");
    if (d.status === "selected") {
      expect(d.wallet).toBe(WALLET.toLowerCase());
      expect(d.groundedDigest).toBe(deterministicGroundedPlanDigest(goodPlan()));
    }
  });
  it("canary + authorized + strict plan FAILS ⇒ blocked (never silently legacy)", () => {
    process.env[ALLOW] = WALLET;
    const bad = goodPlan({ signals: { ...allTrueSignals(), safeTransitionsEstablished: false } });
    const d = evaluateCanarySelection({ mode: "canary", identity: serverId(), plan: bad });
    expect(d).toEqual({ status: "blocked", reason: "signal:safeTransitionsEstablished" });
  });
  it("canary + authorized + NO grounded plan ⇒ blocked (not selected)", () => {
    process.env[ALLOW] = WALLET;
    const d = evaluateCanarySelection({ mode: "canary", identity: serverId(), plan: null });
    expect(d).toEqual({ status: "blocked", reason: "no_grounded_plan" });
  });
});
