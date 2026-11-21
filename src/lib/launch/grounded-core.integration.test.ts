import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * THE CORE MISSION ON A GROUNDED PLAN, through the REAL `inspectAndPlan` (the function the inspection job
 * runs). Only the outside world is substituted: the HTTP inspector, the browser, the repo fetch and the
 * mission brain's models. Everything between is production's own: the canary decision, the core mission
 * and its gate, the budget compiler, the plan compiler, the verification policy compiler, the coverage
 * statement, the commitment and the self-check.
 *
 * Measured on staging (21 Nov 2026): plausible.io, play2048, yara.garden, GitLab and Uniswap were selected
 * as grounded plans and shipped with no core mission. These hold that it cannot happen again, and that no
 * digest, policy or commitment is ever left describing a plan other than the one that ships.
 */
vi.mock("./inspect", () => ({ inspectProduct: vi.fn(), rankPrimaryLinks: vi.fn(() => []) }));
vi.mock("./field-test", () => ({ fieldTestEnabled: vi.fn(() => true), runFieldTest: vi.fn() }));
vi.mock("./github", () => ({ inspectRepo: vi.fn(async () => ({ artifacts: [], reason: null })) }));
vi.mock("./mission-brain", () => ({ runMissionBrain: vi.fn() }));
vi.mock("./field-test-progress", () => ({ recordFieldTestStep: vi.fn(async () => {}) }));

import { CORE_MISSION_KEY } from "@/lib/core-test/shape";
import { checkRevisionPolicyForApproval } from "./approve-policy";
import type { CoreHint } from "./core-mission";
import { attachCoreToGroundedPlan, buildGroundedCoverage, verifyGroundedSelection, type GroundedSelectionRecord } from "./grounded-core";
import { inspectProduct } from "./inspect";
import { runFieldTest } from "./field-test";
import { runMissionBrain } from "./mission-brain";
import { canaryPlanCommitment, deterministicGroundedPlanDigest, type CanaryIdentity } from "./mission-canary";
import type { GroundedCandidatePlan } from "./mission-grounding-shadow";
import type { VerificationPolicyV2 } from "./mission-probe-v2";
import { inspectAndPlan, type LaunchResult } from "./pipeline";
import { scopeFromObservations } from "./product-map";
import type { CandidateMission, FieldTestState, FieldTestSummary, ProductMapV1, ProductObservation } from "./schemas";
import { buildObservationCorpus } from "./validate-mission";

const URL_ = "https://yara.test/";
const WALLET = "0x1111111111111111111111111111111111111111";
const identity: CanaryIdentity = { wallet: WALLET, operatorAuthorized: true, source: "server_session" };

const obs = (url: string): ProductObservation => ({
  url, status: 200, title: "Yara", headings: ["Welcome"], claims: [], ctas: ["Start"], forms: [], links: [],
  authBoundary: false, techHints: [], states: [], landmarks: [], snippets: ["Welcome. Press start."], inspectedAt: 1, contentSha256: "a".repeat(64),
});
const stt = (over: Partial<FieldTestState>): FieldTestState => ({ trigger: "initial load", screenshot: null, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 0, url: URL_, ...over });
const fieldTest = (): FieldTestSummary => ({
  ran: true, startUrl: URL_, mode: "interactive", pages: [], classification: "app", limitation: null, durationMs: 10,
  states: [
    stt({ trigger: "initial load", visibleTextExcerpt: "Welcome. Press start.", notableElements: [{ tag: "button", text: "Start", role: "button" }] }),
    stt({ trigger: "clicked 'Start'", url: `${URL_}play`, visibleTextExcerpt: "You reach the garden world.", notableElements: [{ tag: "button", text: "Talk to Yara", role: "button" }], pixelDeltaPct: 40, networkMethods: ["GET"] }),
  ],
});

const groundedMission = (over: Partial<CandidateMission> = {}): CandidateMission => ({
  missionKey: "reach-world", title: "Reach the garden world", objective: "Reach the world by clicking Start",
  instructions: "1. Click Start. 2. Observe the world.", targetSurface: URL_,
  criteria: ["Reach the garden world after clicking Start"], evidenceRequirements: ["Describe the world state you reached"],
  whyItMatters: "core journey", sources: [{ kind: "page", ref: URL_, observation: "reached the world" }],
  priority: "high", riskCategory: "critical_journey", effortMinutes: 3, conditions: [], rewardWeight: 5, maxCompletions: 4,
  verificationMethod: "the tester's account judged against the observation corpus", confidence: 0.85, assumptions: [], disallowed: [],
  verifiabilityClass: "observation-based",
  ...over,
});
const legacyMission = groundedMission({ missionKey: "legacy-reach", title: "Legacy reach" });

const input = { productUrl: URL_, goal: "explore + talk to Yara", targetUsers: "players", totalBudgetBase: BigInt(10_000_000), tokenDecimals: 6 };
const HINT: CoreHint = { mainAction: "talk to Yara", startsAt: "Start", from: "model" };

const groundedPlan = (missions: CandidateMission[], budget = input.totalBudgetBase): GroundedCandidatePlan => ({
  missions,
  suppliedBudgetBase: budget.toString(),
  allocatedBudgetBase: budget.toString(),
  architectModel: "grounded-arch", architectProvider: "p.test", architectContractVersion: "ga-v1",
  criticModel: "grounded-critic", criticProvider: "p.test", criticContractVersion: "gc-v1",
  observationSetDigest: "set",
  signals: { architectStrictValid: true, compilerProducedMissions: true, everyCriterionCriticSupported: true, allDecisiveGrounded: true, noInferredOnlyDecisive: true, safeTransitionsEstablished: true, canonicalGatePassed: true, allocationExactEqual: true, provenancePresent: true },
  strictSelectable: true,
});

/** The brain's answer: a legacy plan, and (when `missionsFor` is given) a grounded candidate plan beside it. */
function brainAnswers(missionsFor: ((map: ProductMapV1) => CandidateMission[]) | null, opts: { hint?: CoreHint | null; budget?: bigint } = {}) {
  vi.mocked(runMissionBrain).mockImplementation((async (map: ProductMapV1) => {
    const base = { ok: true, reason: null, candidates: [legacyMission], critiques: [], accepted: [legacyMission], reports: [], needsInputQuestions: [], model: "legacy-model", provider: "api.test", promptVersion: "mb-v1", latencyMs: 5 };
    if (!missionsFor) return base;
    const plan = groundedPlan(missionsFor(map), opts.budget);
    plan.observationSetDigest = map.observations?.digest ?? "set";
    return { ...base, groundingShadow: { groundedCandidatePlan: plan }, coreHint: opts.hint === undefined ? HINT : opts.hint };
  }) as never);
}

/** A grounded mission whose one criterion is an action outcome citing the REAL observed "Start" transition (safe: only
 *  a GET was seen). The replay that reproduces it needs a browser, so its record is written here the way the replay
 *  step leaves it; the pipeline reads it from the map exactly as it does in production. */
function actionMissionFor(map: ProductMapV1): CandidateMission {
  const set = map.observations!;
  const t = set.transitions.find((x) => x.locator?.accessibleName === "Start") ?? set.transitions[0]!;
  const facts = set.facts.filter((f) => f.grounding === "seen" && f.stateId === t.afterStateDigest);
  map.replayShadow = { version: "replay-shadow-v1", mode: "shadow", probes: 1, byClassification: { reproduced: 1 }, results: [{ transitionId: t.id, classification: "reproduced" }] } as unknown as ProductMapV1["replayShadow"];
  return groundedMission({
    missionKey: "start-reaches-world",
    title: "Start reaches the garden world",
    groundingV1: { version: "mission-grounding-v1", observationSetDigest: set.digest, criteria: [{ criterionIndex: 0, criterionKind: "action_outcome", sourceFactIds: facts.map((f) => f.id), sourceTransitionIds: [t.id], evidenceIndex: 0, verificationMode: "observation" }] } as CandidateMission["groundingV1"],
  });
}

const run = (over: Partial<typeof input> = {}, opts: { identity?: CanaryIdentity | null } = {}) =>
  inspectAndPlan({ ...input, ...over }, "camp-core", () => {}, 1, { inspectionId: "insp-core", canaryIdentity: opts.identity === undefined ? identity : opts.identity });

/** Rebuild what the pipeline selected, from the result alone, and check its record the way any reader can. */
function recheck(r: LaunchResult, base: CandidateMission[], hint: CoreHint | null, tamper: (rec: GroundedSelectionRecord) => GroundedSelectionRecord = (x) => x, budget = input.totalBudgetBase) {
  const map = r.map!;
  const scope = scopeFromObservations([obs(URL_)], [], map.fieldTest);
  const corpus = buildObservationCorpus([obs(URL_)], map.fieldTest);
  const plan = groundedPlan(base, budget);
  plan.observationSetDigest = map.observations!.digest;
  const attached = attachCoreToGroundedPlan(plan, { map, productUrl: URL_, scope, corpus, modelHint: hint });
  const c = r.canary!;
  const record: GroundedSelectionRecord = {
    groundedDigest: c.groundedDigest!, planDigest: c.planDigest!, planCommitment: c.planCommitment!, coverage: c.coverage!,
    verificationPolicy: (c.verificationPolicy ?? null) as VerificationPolicyV2 | null, verificationPolicyDigest: c.verificationPolicyDigest ?? null, verificationPolicyRequired: c.verificationPolicyRequired ?? false,
  };
  return { attached, check: verifyGroundedSelection({ groundedPlan: attached.plan, plan: r.plan!, founderBudgetBase: budget, tokenDecimals: 6, record: tamper(structuredClone(record)) }) };
}

const keys = (r: LaunchResult) => r.plan!.missions.map((m) => m.missionKey);
const spent = (r: LaunchResult) => r.plan!.missions.reduce((s, m) => s + m.rewardBase * m.maxCompletions, BigInt(0));

beforeEach(() => {
  process.env.MISSION_GROUNDING_MODE = "canary";
  process.env.MISSION_CANARY_ALLOWLIST = WALLET;
  vi.mocked(inspectProduct).mockResolvedValue({ startUrl: URL_, host: "yara.test", observations: [obs(URL_)], limitations: [], blocked: [] });
  vi.mocked(runFieldTest).mockResolvedValue(fieldTest());
});
afterEach(() => {
  delete process.env.MISSION_GROUNDING_MODE;
  delete process.env.MISSION_CANARY_ALLOWLIST;
});

describe("a selected grounded plan carries the core mission", () => {
  it("exactly one, first, with the fixed words, and the money exact", async () => {
    brainAnswers(() => [groundedMission()]);
    const r = await run();
    expect(r.stage).toBe("ready");
    expect(r.canary?.status).toBe("selected");
    expect(keys(r)).toEqual([CORE_MISSION_KEY, "reach-world"]);
    const core = r.plan!.missions[0]!;
    expect(core.title).toBe("Try Yara for the first time and say how far you got");
    expect(core.instructions).toContain("try to talk to Yara, starting from “Start”");
    expect(core.verifiabilityClass).toBe("observation-based");
    expect(core.rewardBase > BigInt(0)).toBe(true);
    expect(r.plan!.allocatedBase).toBe(input.totalBudgetBase);
    expect(spent(r)).toBe(input.totalBudgetBase);
    // the plan is still the grounded one, by the grounded architect
    expect(r.canary?.planSource).toBe("grounded_v2");
    expect(r.canary?.provenance?.architectModel).toBe("grounded-arch");
  });

  it("the grounded digest, the plan digest and the commitment all describe the plan WITH its core", async () => {
    brainAnswers(() => [groundedMission()]);
    const r = await run();
    const { attached, check } = recheck(r, [groundedMission()], HINT);
    expect(check).toEqual({ ok: true });
    expect(attached.plan.missions.map((m) => m.missionKey)).toEqual(keys(r));
    // the digest is over the plan with the core, not the one the canary first saw
    expect(r.canary!.groundedDigest).toBe(deterministicGroundedPlanDigest(attached.plan));
    expect(r.canary!.groundedDigest).not.toBe(deterministicGroundedPlanDigest(groundedPlan([groundedMission()])));
    expect(r.canary!.provenance!.groundedPlanDigest).toBe(r.canary!.groundedDigest);
    expect(r.canary!.planDigest).toBe(r.plan!.missionPlanDigest);
    expect(r.canary!.provenance!.missionPlanDigest).toBe(r.plan!.missionPlanDigest);
    // the commitment binds the compiled plan, the budget, the revision and the coverage statement
    expect(r.canary!.planCommitment).toBe(
      canaryPlanCommitment({ planDigest: r.plan!.missionPlanDigest, budgetText: "10000000 base units @ 6dp", budgetBase: "10000000", revision: 1, coverageDigest: r.canary!.coverage!.coverageDigest }).commitment,
    );
  });

  it("with no action criterion: no policy is attached, and the coverage says the core is observation-based and outside any covenant", async () => {
    brainAnswers(() => [groundedMission()]);
    const r = await run();
    const c = r.canary!;
    expect(c.verificationPolicyRequired).toBe(false);
    expect(c.verificationPolicy).toBeNull(); // a policy is stored if and only if it is required
    expect(c.verificationPolicyDigest).toBeNull();
    expect(c.coverage).toMatchObject({
      version: "grounded-coverage-v1",
      missionPlanDigest: r.plan!.missionPlanDigest,
      policyRequired: false,
      policyDigest: null,
      core: { missionKey: CORE_MISSION_KEY, verifiabilityClass: "observation-based", replayCovenant: "outside", hintFrom: "model" },
      coreAbsentReason: null,
    });
    expect(c.coverage!.missions).toEqual([
      { missionKey: CORE_MISSION_KEY, core: true, verifiabilityClass: "observation-based", replayCovenant: "outside" },
      { missionKey: "reach-world", core: false, verifiabilityClass: "observation-based", replayCovenant: "outside" },
    ]);
    expect(c.provenance!.coverage).toEqual(c.coverage); // kept on the revision
  });

  it("with an action mission: the policy is required, binds the plan that HAS the core, and names no criterion for the core", async () => {
    brainAnswers((map) => [actionMissionFor(map)]);
    const r = await run();
    expect(r.reason).toBeNull();
    expect(r.stage).toBe("ready");
    expect(keys(r)).toEqual([CORE_MISSION_KEY, "start-reaches-world"]);
    const c = r.canary!;
    const policy = c.verificationPolicy as VerificationPolicyV2;
    expect(c.verificationPolicyRequired).toBe(true);
    expect(policy.missionPlanDigest).toBe(r.plan!.missionPlanDigest);
    expect(policy.actionCriteria.map((a) => a.missionKey)).toEqual(["start-reaches-world"]);
    expect(policy.probes.map((p) => p.missionKey)).toEqual(["start-reaches-world"]);
    expect(c.coverage!.policyRequired).toBe(true);
    expect(c.coverage!.policyDigest).toBe(policy.policyDigest);
    expect(c.coverage!.core).toMatchObject({ replayCovenant: "outside", verifiabilityClass: "observation-based" });
    expect(c.coverage!.missions).toEqual([
      { missionKey: CORE_MISSION_KEY, core: true, verifiabilityClass: "observation-based", replayCovenant: "outside" },
      { missionKey: "start-reaches-world", core: false, verifiabilityClass: "observation-based", replayCovenant: "inside" },
    ]);
    // the approval door's own check accepts the policy against this plan
    expect(checkRevisionPolicyForApproval({ verificationPolicy: policy, verificationPolicyDigest: c.verificationPolicyDigest!, verificationPolicyRequired: true, planMissionPlanDigest: r.plan!.missionPlanDigest })).toMatchObject({ ok: true });
    expect(spent(r)).toBe(input.totalBudgetBase);
  });

  it("uses the product's own words when the brain named no main action", async () => {
    brainAnswers(() => [groundedMission({ title: "Reach the garden world" })], { hint: null });
    const r = await run();
    expect(keys(r)).toEqual([CORE_MISSION_KEY, "reach-world"]);
    expect(r.canary!.coverage!.core!.hintFrom).toBe("accepted-mission");
    expect(r.plan!.missions[0]!.instructions).toContain("try to reach the garden world");
  });

  it("never twice: a grounded plan that already has a mission under the core's key keeps that one", async () => {
    brainAnswers(() => [groundedMission({ missionKey: CORE_MISSION_KEY }), groundedMission()]);
    const r = await run();
    expect(r.stage).toBe("ready");
    expect(keys(r).filter((k) => k === CORE_MISSION_KEY)).toHaveLength(1);
    expect(keys(r)).toHaveLength(2);
    expect(spent(r)).toBe(input.totalBudgetBase);
  });

  it("a budget that cannot carry one more mission ships the selected plan as it was, and says the core is absent and why", async () => {
    const budget = BigInt(600_000); // one mission at the tangible floor, not two
    brainAnswers(() => [groundedMission()], { budget });
    const r = await run({ totalBudgetBase: budget });
    expect(r.reason).toBeNull();
    expect(r.stage).toBe("ready");
    expect(keys(r)).toEqual(["reach-world"]);
    expect(spent(r)).toBe(budget);
    expect(r.canary!.coverage).toMatchObject({ core: null, coreAbsentReason: "budget_cannot_fund" });
    // nothing describes a plan that did not ship: the digest is the canary's own, over the plan without a core
    expect(r.canary!.groundedDigest).toBe(deterministicGroundedPlanDigest({ ...groundedPlan([groundedMission()], budget), observationSetDigest: r.map!.observations!.digest }));
  });

  const three = () => [
    groundedMission(),
    groundedMission({ missionKey: "talk-to-yara", title: "Talk to Yara in the garden", objective: "Find the Talk to Yara button in the garden world and report what it says", criteria: ["The garden world shows a Talk to Yara button"], priority: "medium" }),
    groundedMission({ missionKey: "read-welcome", title: "Read the welcome screen", objective: "Report the words on the welcome screen before pressing Start", criteria: ["The welcome screen says Press start"], priority: "low" }),
  ];

  it("a $20 test with three grounded missions carries all three and the core", async () => {
    const budget = BigInt(20_000_000);
    brainAnswers(three, { budget });
    const r = await run({ totalBudgetBase: budget });
    expect(r.reason).toBeNull();
    expect([...keys(r)].sort()).toEqual([CORE_MISSION_KEY, "reach-world", "read-welcome", "talk-to-yara"].sort());
    expect(keys(r)[0]).toBe(CORE_MISSION_KEY);
    expect(spent(r)).toBe(budget);
    expect(recheck(r, three(), HINT, (x) => x, budget).check).toEqual({ ok: true });
  });

  it("the core never displaces a grounded mission: on a budget where it would, the plan ships as it would have without it", async () => {
    // find, by the allocator's own behaviour, a budget where three missions are funded but four are not
    let found: bigint | null = null;
    for (let cents = 100; cents <= 600 && found === null; cents += 10) {
      const budget = BigInt(cents * 10_000);
      brainAnswers(three, { budget });
      const r = await run({ totalBudgetBase: budget });
      if (r.stage === "ready" && r.canary!.coverage!.coreAbsentReason === "budget_cannot_fund" && keys(r).length > 1) found = budget;
    }
    expect(found).not.toBeNull();
    const budget = found!;
    brainAnswers(three, { budget });
    const withDoor = await run({ totalBudgetBase: budget });
    expect(keys(withDoor)).not.toContain(CORE_MISSION_KEY);
    expect(keys(withDoor).length).toBeGreaterThan(1); // more than the one mission a core-first allocation would have left
    expect(spent(withDoor)).toBe(budget);
    const c = withDoor.canary!;
    const shippedPlan = { ...groundedPlan(three().filter((m) => keys(withDoor).includes(m.missionKey)), budget), observationSetDigest: withDoor.map!.observations!.digest };
    expect(c.groundedDigest).toBe(deterministicGroundedPlanDigest(shippedPlan));
    expect(
      verifyGroundedSelection({ groundedPlan: shippedPlan, plan: withDoor.plan!, founderBudgetBase: budget, tokenDecimals: 6, record: { groundedDigest: c.groundedDigest!, planDigest: c.planDigest!, planCommitment: c.planCommitment!, coverage: c.coverage!, verificationPolicy: null, verificationPolicyDigest: null, verificationPolicyRequired: false } }),
    ).toEqual({ ok: true });
  });

  it("when the allocator drops a mission, the record describes the missions that ship", async () => {
    const budget = BigInt(600_000);
    brainAnswers(three, { budget });
    const r = await run({ totalBudgetBase: budget });
    expect(r.reason).toBeNull();
    expect(keys(r)).toEqual(["reach-world"]);
    expect(spent(r)).toBe(budget);
    expect(r.canary!.coverage!.missions.map((m) => m.missionKey)).toEqual(["reach-world"]);
    expect(r.canary!.groundedDigest).toBe(deterministicGroundedPlanDigest({ ...groundedPlan([groundedMission()], budget), observationSetDigest: r.map!.observations!.digest }));
  });
});

describe("a record that no longer matches its plan is refused", () => {
  const selected = async () => {
    brainAnswers((map) => [actionMissionFor(map)]);
    const r = await run();
    const base = [actionMissionFor(structuredClone(r.map!))];
    return { r, base };
  };
  const refusal = async (tamper: (rec: GroundedSelectionRecord) => GroundedSelectionRecord) => {
    const { r, base } = await selected();
    expect(recheck(r, base, HINT).check).toEqual({ ok: true });
    return recheck(r, base, HINT, tamper).check;
  };

  it("a tampered commitment", async () => {
    expect(await refusal((rec) => ({ ...rec, planCommitment: rec.planCommitment.replace(/^./, (c) => (c === "0" ? "1" : "0")) }))).toEqual({ ok: false, reason: "commitment_mismatch" });
  });
  it("a commitment taken without the coverage (the old shape) or over another budget", async () => {
    const { r } = await selected();
    const old = canaryPlanCommitment({ planDigest: r.plan!.missionPlanDigest, budgetText: "10000000 base units @ 6dp", budgetBase: "10000000", revision: 1 }).commitment;
    expect(await refusal((rec) => ({ ...rec, planCommitment: old }))).toEqual({ ok: false, reason: "commitment_mismatch" });
    const other = canaryPlanCommitment({ planDigest: r.plan!.missionPlanDigest, budgetText: "20000000 base units @ 6dp", budgetBase: "20000000", revision: 1, coverageDigest: r.canary!.coverage!.coverageDigest }).commitment;
    expect(await refusal((rec) => ({ ...rec, planCommitment: other }))).toEqual({ ok: false, reason: "commitment_mismatch" });
  });
  it("a grounded digest taken before the core joined", async () => {
    const { r, base } = await selected();
    const before = deterministicGroundedPlanDigest({ ...groundedPlan(base), observationSetDigest: r.map!.observations!.digest });
    expect(recheck(r, base, HINT, (rec) => ({ ...rec, groundedDigest: before })).check).toEqual({ ok: false, reason: "grounded_digest_mismatch" });
  });
  it("a coverage statement that puts the core inside the covenant, or was edited", async () => {
    expect(await refusal((rec) => ({ ...rec, coverage: { ...rec.coverage, missions: rec.coverage.missions.map((m) => ({ ...m, replayCovenant: "inside" as const })) } }))).toEqual({ ok: false, reason: "coverage_mismatch" });
    expect(await refusal((rec) => ({ ...rec, coverage: { ...rec.coverage, core: null, coreAbsentReason: "gate_refused" } }))).toEqual({ ok: false, reason: "coverage_core_disagrees" });
  });
  it("a policy bound to another plan, edited, dropped, or naming the core", async () => {
    expect(await refusal((rec) => ({ ...rec, verificationPolicy: { ...rec.verificationPolicy!, missionPlanDigest: "0xother" } }))).toEqual({ ok: false, reason: "policy_digest_mismatch" });
    expect(await refusal((rec) => ({ ...rec, verificationPolicy: null }))).toEqual({ ok: false, reason: "policy_required_disagrees" });
    expect(await refusal((rec) => ({ ...rec, verificationPolicy: null, verificationPolicyRequired: false }))).toEqual({ ok: false, reason: "policy_digest_without_policy" });
    expect(await refusal((rec) => ({ ...rec, verificationPolicy: null, verificationPolicyDigest: null, verificationPolicyRequired: false }))).toEqual({ ok: false, reason: "coverage_mismatch" });
    expect(await refusal((rec) => ({ ...rec, verificationPolicy: { ...rec.verificationPolicy!, actionCriteria: [...rec.verificationPolicy!.actionCriteria, { missionKey: CORE_MISSION_KEY, criterionIndex: 0, probeDigest: "x" }] } }))).toEqual({ ok: false, reason: "policy_digest_mismatch" });
  });
  it("a plan whose missions are not the grounded plan's (a mission added or dropped after the record)", async () => {
    const { r, base } = await selected();
    const map = r.map!;
    const plan = { ...groundedPlan(base), observationSetDigest: map.observations!.digest }; // the plan WITHOUT its core
    const c = r.canary!;
    const record: GroundedSelectionRecord = { groundedDigest: c.groundedDigest!, planDigest: c.planDigest!, planCommitment: c.planCommitment!, coverage: c.coverage!, verificationPolicy: c.verificationPolicy as VerificationPolicyV2, verificationPolicyDigest: c.verificationPolicyDigest!, verificationPolicyRequired: true };
    expect(verifyGroundedSelection({ groundedPlan: plan, plan: r.plan!, founderBudgetBase: input.totalBudgetBase, tokenDecimals: 6, record })).toEqual({ ok: false, reason: "plan_missions_differ_from_grounded" });
    // money that does not add up is refused before any hash is looked at
    const short = { ...r.plan!, missions: r.plan!.missions.map((m, i) => (i === 0 ? { ...m, rewardBase: m.rewardBase - BigInt(1) } : m)) };
    const withCore = recheck(r, base, HINT).attached.plan;
    expect(verifyGroundedSelection({ groundedPlan: withCore, plan: short, founderBudgetBase: input.totalBudgetBase, tokenDecimals: 6, record })).toEqual({ ok: false, reason: "budget_not_exact" });
  });
  it("a coverage built from a policy that names the core says so, and is refused", async () => {
    const { r, base } = await selected();
    const policy = r.canary!.verificationPolicy as VerificationPolicyV2;
    const forged = buildGroundedCoverage({ plan: r.plan!, policy: { policyDigest: policy.policyDigest, actionCriteria: [...policy.actionCriteria, { missionKey: CORE_MISSION_KEY, criterionIndex: 0, probeDigest: "x" }] }, coreHintFrom: "model", coreAbsentReason: null });
    expect(forged.missions.find((m) => m.core)!.replayCovenant).toBe("inside");
    expect(recheck(r, base, HINT, (rec) => ({ ...rec, coverage: forged })).check).toEqual({ ok: false, reason: "coverage_mismatch" });
  });
});

describe("the legacy path is unchanged", () => {
  const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

  it("a founder the canary does not cover gets the same legacy plan whether or not a grounded plan sits beside it", async () => {
    brainAnswers(null);
    const plain = await run({}, { identity: null });
    brainAnswers(() => [groundedMission()]);
    const beside = await run({}, { identity: null });
    expect(beside.canary?.status).toBe("unauthorized");
    expect(keys(beside)).toEqual(["legacy-reach"]); // the pipeline adds nothing to a legacy plan: its core comes from the brain
    expect(json(beside.plan)).toBe(json(plain.plan));
    expect(json(beside.allocation)).toBe(json(plain.allocation));
    expect(beside.canary?.coverage).toBeUndefined();
  });

  it("with the canary off, a grounded plan beside the legacy one changes nothing", async () => {
    process.env.MISSION_GROUNDING_MODE = "shadow";
    brainAnswers(null);
    const plain = await run();
    brainAnswers(() => [groundedMission()]);
    const beside = await run();
    expect(beside.canary?.status).toBe("disabled");
    expect(json(beside.plan)).toBe(json(plain.plan));
    expect(json(beside.allocation)).toBe(json(plain.allocation));
  });

  it("a commitment taken without a coverage digest is byte-identical to what it always was", async () => {
    const { createHash } = await import("node:crypto");
    const base = { planDigest: "0xPLAN", budgetText: "10 USDC", budgetBase: "10000000", revision: 1 };
    const was = createHash("sha256").update(JSON.stringify({ v: "canary-plan-commitment-v1", ...base })).digest("hex");
    expect(canaryPlanCommitment(base).commitment).toBe(was);
    expect(canaryPlanCommitment({ ...base, coverageDigest: "abc" }).commitment).not.toBe(was);
  });
});
