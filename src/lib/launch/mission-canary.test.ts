import { describe, it, expect, afterEach } from "vitest";
import {
  canaryAllowlist,
  resolveCanaryAuthority,
  firstUnmetStrictCondition,
  deterministicGroundedPlanDigest,
  bindCanaryApproval,
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
const WALLET = "0xFOUNDER0000000000000000000000000000AbCd";
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
  criticModel: "gemini-3.1-flash-lite-preview",
  criticProvider: "commonstack",
  observationSetDigest: "abc123",
  signals: allTrueSignals(),
  strictSelectable: true,
  ...over,
});

const serverId = (over: Partial<CanaryIdentity> = {}): CanaryIdentity => ({ wallet: WALLET, optedIn: true, source: "server_session", ...over });

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
    const forged = { wallet: WALLET, optedIn: true, source: "founder_text" } as unknown as CanaryIdentity;
    expect(resolveCanaryAuthority("canary", forged)).toEqual({ allowed: false, reason: "no_server_identity" });
  });
  it("not opted in ⇒ denied", () => {
    process.env[ALLOW] = WALLET;
    expect(resolveCanaryAuthority("canary", serverId({ optedIn: false }))).toEqual({ allowed: false, reason: "not_opted_in" });
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

describe("bindCanaryApproval — token binds plan digest + budget + revision", () => {
  it("same inputs ⇒ same token; any change ⇒ different token", () => {
    const base = { planDigest: "0xdig", budgetText: "10000000 base units @ 6dp", budgetBase: "10000000", revision: 1 };
    const t = bindCanaryApproval(base).token;
    expect(bindCanaryApproval(base).token).toBe(t);
    expect(bindCanaryApproval({ ...base, planDigest: "0xOTHER" }).token).not.toBe(t);
    expect(bindCanaryApproval({ ...base, budgetBase: "20000000" }).token).not.toBe(t);
    expect(bindCanaryApproval({ ...base, revision: 2 }).token).not.toBe(t);
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
