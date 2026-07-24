import { describe, it, expect } from "vitest";
import {
  compileGoalMission,
  resolveEntityForCheckpoint,
  applyProseRefinement,
} from "./goal-mission-compiler";
import {
  checkJourneyCoverage,
  type GoalJourneyV1,
  type JourneyStep,
  type MissionCoverageView,
} from "./goal-journey";
import { buildJourneySteps } from "./goal-journey";
import { applySamplePolicy, splitCompletionsForSample } from "./sample-policy";
import { allocateBudget, MIN_REWARD_BASE } from "./budget";
import type { ProductContextV1, EntityInstanceV1 } from "./product-context";
import type { ObservedFactV1, ActionTransitionV1 } from "./observed-facts";
import fixture from "./__fixtures__/yara-production-run.json";

/**
 * DETERMINISTIC GOAL→MISSION COMPILER — proven by REPLAYING retained production observations with zero
 * provider calls, plus product-agnostic unit cases. The compiler (never a model) owns every mapping,
 * fact id, evidence index, entity id and evidence mode.
 */

/* ── the retained production run (real observations from a live yara.garden inspection) ── */
const journey = fixture.goalJourney as unknown as GoalJourneyV1;
const context = fixture.productContext as unknown as ProductContextV1;
const facts = fixture.observations.facts as unknown as ObservedFactV1[];
const transitions = fixture.observations
  .transitions as unknown as ActionTransitionV1[];
const steps: JourneyStep[] = buildJourneySteps(
  fixture.states as never,
  facts,
  transitions,
  // rebuild the same state ids the run used: take them from the facts, in state order
  (fixture.states as unknown[]).map((_, i) => {
    const f = facts.find(
      (x) =>
        x.stateId && x.stateId.length > 0 && factStateIndex(x.stateId) === i,
    );
    return f?.stateId ?? "";
  }),
).map((s, i) => ({ ...s, phase: context.statePhases[i] }));

/** map a stateId back to its index via the productContext entities (which carry both). */
function factStateIndex(stateId: string): number {
  const e = context.entities.find((x) => x.stateId === stateId);
  return e ? e.stateIndex : -1;
}

const compileInput = () => ({
  journey,
  context,
  steps,
  facts,
  transitions,
  productUrl: "https://yara.garden/",
  totalBudgetBase: BigInt(fixture.totalBudgetBase),
});

describe("OFFLINE REPLAY — retained production observations, zero provider calls", () => {
  it("resolves the conversational entity over the location with the same name", () => {
    const cp = journey.checkpoints.find((c) => c.kind === "outcome")!;
    const r = resolveEntityForCheckpoint(
      cp,
      context,
      steps,
      steps.findIndex((s) => s.actionKind === "observe_response"),
    );
    expect(r.ambiguous).toBe(false); // NOT ambiguous merely because several labels contain "yara"
    expect(r.resolved).toBeTruthy();
    expect(r.resolved!.label).toBe("Yara."); // the entity that opened the conversation
    const grove = r.ranked.find((x) => /grove/i.test(x.entity.label));
    const yara = r.ranked.find((x) => x.entity.label === "Yara.");
    expect(grove).toBeTruthy();
    expect(yara!.score).toBeGreaterThan(grove!.score); // a location ranks BELOW the conversational entity
  });

  it("compiles a complete grounded mission from the real journey", () => {
    const r = compileGoalMission(compileInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { mission, mappings, criteria } = r.compiled;
    // the deterministic skeleton: reach the entity + open it, then send + observe the response
    expect(criteria).toHaveLength(2);
    expect(mission.criteria).toHaveLength(2);
    expect(mission.evidenceRequirements).toHaveLength(2);
    // EVERY checkpoint maps to one criterion/evidence pair
    const mapped = new Set(mappings.map((m) => m.checkpointId));
    for (const c of journey.checkpoints)
      expect(mapped.has(c.checkpointId)).toBe(true);
    // send-state and response-state evidence are DISTINCT
    const outcome = criteria[1];
    const sendCp = journey.checkpoints.find((c) => c.kind === "input")!;
    const respCp = journey.checkpoints.find((c) => c.kind === "outcome")!;
    expect(
      respCp.evidence.factIds.some((f) => outcome.factIds.includes(f)),
    ).toBe(true);
    expect(
      sendCp.evidence.factIds.some((f) => outcome.factIds.includes(f)),
    ).toBe(true);
    expect(respCp.evidence.factIds).not.toEqual(sendCp.evidence.factIds);
    // every cited fact is a REAL observed fact
    for (const c of criteria)
      for (const f of c.factIds)
        expect(facts.some((x) => x.id === f)).toBe(true);
    // anchors are verbatim observed strings
    expect(mission.anchors!.length).toBeGreaterThan(0);
    const corpus = JSON.stringify(facts).toLowerCase();
    for (const a of mission.anchors!) expect(corpus).toContain(a.toLowerCase());
  });

  it("PASSES the unchanged strict coverage gate (full checkpoint coverage)", () => {
    const r = compileGoalMission(compileInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.compiled.mission;
    const view: MissionCoverageView = {
      missionKey: m.missionKey,
      title: m.title,
      objective: m.objective,
      instructions: m.instructions,
      criteria: m.criteria,
      evidenceRequirements: m.evidenceRequirements,
      grounding: (m.groundingV1?.criteria ?? []).map((g) => ({
        criterionIndex: g.criterionIndex,
        evidenceIndex: g.evidenceIndex,
        factIds: g.sourceFactIds,
        transitionIds: g.sourceTransitionIds ?? [],
        evidenceMode: g.verificationMode,
      })),
      prerequisites: [],
    };
    const cov = checkJourneyCoverage(journey, [view]);
    expect(cov.rejections).toEqual([]);
    expect(cov.ok).toBe(true);
    expect(cov.coveredCount).toBe(cov.requiredCount);
    expect(cov.mappings).toHaveLength(journey.checkpoints.length);
  });

  it("the sample policy turns it into 3 × $0.50 = $1.50 exactly", () => {
    const r = compileGoalMission(compileInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.compiled.mission;
    const sample = applySamplePolicy(
      [
        {
          missionKey: m.missionKey,
          maxCompletions: m.maxCompletions,
          rewardWeight: m.rewardWeight,
          qualitative: true,
        },
      ],
      {
        goal: journey.goal,
        totalBudgetBase: BigInt(fixture.totalBudgetBase),
        minRewardBase: MIN_REWARD_BASE,
      },
    );
    expect(sample.question).toBeNull();
    expect(sample.missions[0].maxCompletions).toBe(3);
    const alloc = allocateBudget(
      [
        {
          missionKey: m.missionKey,
          weight: m.rewardWeight,
          suggestedMaxCompletions: sample.missions[0].maxCompletions,
          priority: m.priority,
          effortMinutes: m.effortMinutes,
        },
      ],
      BigInt(fixture.totalBudgetBase),
    );
    expect(alloc.ok).toBe(true);
    // the allocator's exactness strategy gives a single-mission plan 1 completion worth the whole pot;
    // the sample split re-expresses that SAME pot as three independent testers.
    const split = splitCompletionsForSample(
      alloc.missions,
      new Map([[m.missionKey, sample.missions[0].maxCompletions]]),
      MIN_REWARD_BASE,
    );
    expect(split[0].maxCompletions).toBe(BigInt(3));
    expect(split[0].rewardBase).toBe(BigInt(500_000)); // $0.50 each
    const total = split.reduce(
      (s, x) => s + x.rewardBase * x.maxCompletions,
      BigInt(0),
    );
    expect(total).toBe(BigInt(1_500_000)); // exactly $1.50
  });
});

/* ─────────────────── product-agnostic unit cases (generic product) ────────── */

const ent = (
  over: Partial<EntityInstanceV1> & { entityId: string; label: string },
): EntityInstanceV1 => ({
  kind: "control",
  phase: "main_experience",
  stateId: "s",
  stateIndex: 0,
  affordances: ["click"],
  ...over,
});
const genericContext = (entities: EntityInstanceV1[]): ProductContextV1 => ({
  version: "product-context-v1",
  statePhases: ["entry", "onboarding", "main_experience", "target_interaction"],
  entities,
  phaseTransitions: [],
});
const cpOf = (over: Partial<GoalJourneyV1["checkpoints"][number]> = {}) => ({
  checkpointId: "cpX",
  kind: "interaction" as const,
  requirement: "Open the helper conversation",
  targetEntity: "helper",
  requiredContext: "",
  dependsOn: [],
  sourcePhrase: "talk to the helper",
  evidence: { factIds: ["f1"], transitionIds: [] },
  status: "observed" as const,
  requiredPhase: "main_experience" as const,
  boundEntityId: null,
  ...over,
});
const stepOf = (i: number, over: Partial<JourneyStep> = {}): JourneyStep => ({
  stateIndex: i,
  actionKind: "click",
  actedLabel: "",
  stateText: "",
  addedText: "",
  observableChange: true,
  factIds: [`f${i}`],
  transitionId: null,
  phase: "main_experience",
  ...over,
});

describe("#1/#2 location vs conversational entity — behavioural disambiguation", () => {
  it("prefers the entity whose click led to the outcome, not the place with the same name", () => {
    const ctx = genericContext([
      ent({ entityId: "place", label: "Helper Hall", stateIndex: 1 }),
      ent({ entityId: "person", label: "Helper", stateIndex: 3 }),
    ]);
    const steps = [
      stepOf(1, { actedLabel: "Helper Hall" }),
      stepOf(2),
      stepOf(3, { actedLabel: "Helper" }),
      stepOf(4, { actionKind: "observe_response" }),
    ];
    const r = resolveEntityForCheckpoint(cpOf(), ctx, steps, 3);
    expect(r.resolved?.entityId).toBe("person");
    expect(r.ambiguous).toBe(false);
  });

  it("does NOT ask merely because several labels share a word", () => {
    const ctx = genericContext([
      ent({ entityId: "a", label: "Helper Hall", stateIndex: 1 }),
      ent({
        entityId: "b",
        label: "Helper Statue",
        stateIndex: 1,
        affordances: [],
        kind: "item",
      }),
      ent({ entityId: "c", label: "Helper", stateIndex: 3 }),
    ]);
    const steps = [
      stepOf(3, { actedLabel: "Helper" }),
      stepOf(4, { actionKind: "observe_response" }),
    ];
    const r = resolveEntityForCheckpoint(cpOf(), ctx, steps, 1);
    expect(r.ambiguous).toBe(false);
    expect(r.resolved?.entityId).toBe("c");
  });

  it("asks ONLY when the leaders are behaviourally equivalent", () => {
    const ctx = genericContext([
      ent({ entityId: "x", label: "Helper One", stateIndex: 2 }),
      ent({ entityId: "y", label: "Helper Two", stateIndex: 2 }),
    ]);
    const r = resolveEntityForCheckpoint(cpOf(), ctx, [stepOf(2)], null);
    expect(r.ambiguous).toBe(true);
    expect(r.resolved).toBeNull();
  });
});

describe("#7 architect prose failure falls back to deterministic copy", () => {
  it("keeps the grounded skeleton when prose is missing/garbage", () => {
    const r = compileGoalMission(compileInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const base = r.compiled.mission;
    for (const bad of [
      null,
      undefined,
      {},
      { title: "" },
      { title: 5 },
      { objective: "   " },
    ]) {
      const merged = applyProseRefinement(base, bad as never);
      expect(merged.title).toBe(base.title);
      expect(merged.criteria).toEqual(base.criteria);
      expect(merged.groundingV1).toEqual(base.groundingV1);
      expect(merged.anchors).toEqual(base.anchors);
    }
  });

  it("accepts only the four prose fields from a good refinement", () => {
    const r = compileGoalMission(compileInput());
    if (!r.ok) return;
    const base = r.compiled.mission;
    const merged = applyProseRefinement(base, {
      title: "Meet the character and get a reply",
      objective:
        "Walk in, find her, say hello, and note what she says back to you.",
      instructions:
        "Open the site, step inside, find her, send a message, and quote the reply.",
      whyItMatters:
        "The founder wants to know the conversation actually works for a newcomer.",
    });
    expect(merged.title).toBe("Meet the character and get a reply");
    expect(merged.criteria).toEqual(base.criteria); // criteria are NEVER model-writable
    expect(merged.groundingV1).toEqual(base.groundingV1);
  });
});

describe("#3/#4/#5/#6 grouping, criteria and complete mapping", () => {
  it("#3 prerequisites become instructions and attach to the first core criterion", () => {
    const r = compileGoalMission(compileInput());
    if (!r.ok) return;
    const { criteria, mission } = r.compiled;
    const entryCp = journey.checkpoints.find((c) => c.kind === "entry")!;
    expect(criteria[0].checkpointIds).toContain(entryCp.checkpointId); // attached, not its own paid criterion
    expect(mission.instructions.toLowerCase()).toContain(
      entryCp.requirement.toLowerCase().slice(0, 12),
    );
  });

  it("#4 navigation + opening the target is ONE core criterion", () => {
    const r = compileGoalMission(compileInput());
    if (!r.ok) return;
    expect(r.compiled.criteria[0].text.toLowerCase()).toMatch(
      /reach|navigat|locate/,
    );
    expect(r.compiled.criteria[0].factIds.length).toBeGreaterThan(0);
  });

  it("#5 send + response is ONE outcome criterion with distinct evidence and an observation mode", () => {
    const r = compileGoalMission(compileInput());
    if (!r.ok) return;
    const c = r.compiled.criteria[1];
    expect(c.text.toLowerCase()).toMatch(/response|reply/);
    expect(c.evidenceMode).toBe("observation"); // unsafe transitions stay manual/lived
    expect(c.transitionIds).toEqual([]); // none of this product's transitions are replay-safe
  });

  it("#6 no repetitive criteria — 5 checkpoints compile to 2 criteria, all mapped", () => {
    const r = compileGoalMission(compileInput());
    if (!r.ok) return;
    expect(journey.checkpoints.length).toBeGreaterThan(
      r.compiled.criteria.length,
    );
    expect(new Set(r.compiled.mappings.map((m) => m.checkpointId)).size).toBe(
      journey.checkpoints.length,
    );
  });
});
