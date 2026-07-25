import { describe, it, expect } from "vitest";
import { compileGoalMission, compileGoalMissions } from "./goal-mission-compiler";
import {
  buildJourneySteps,
  checkJourneyCoverage,
  type GoalJourneyV1,
  type JourneyStep,
  type MissionCoverageView,
} from "./goal-journey";
import { singleMissionPartition } from "./mission-partition";
import { allocateBudget, MIN_REWARD_BASE } from "./budget";
import { buildObservationCorpus, anchorIssues } from "./validate-mission";
import type { ProductContextV1 } from "./product-context";
import type { ObservedFactV1, ActionTransitionV1 } from "./observed-facts";
import type { CandidateMission } from "./schemas";
import fixture from "./__fixtures__/yara-production-run.json";

/**
 * ONE MISSION PER SEGMENT — replayed over retained production observations, zero provider calls.
 *
 * The founder's journey used to compile into exactly one mission no matter what it contained. The
 * model now proposes where to cut it; everything that makes a mission payable still comes from the
 * compiler. These tests hold that line: each segment's criteria are compiled from observed evidence,
 * the set still covers every checkpoint the founder asked for, and the money still lands exactly.
 */

const journey = fixture.goalJourney as unknown as GoalJourneyV1;
const context = fixture.productContext as unknown as ProductContextV1;
const facts = fixture.observations.facts as unknown as ObservedFactV1[];
const transitions = fixture.observations
  .transitions as unknown as ActionTransitionV1[];
const stateIndexOf = (stateId: string) =>
  context.entities.find((x) => x.stateId === stateId)?.stateIndex ?? -1;
const steps: JourneyStep[] = buildJourneySteps(
  fixture.states as never,
  facts,
  transitions,
  (fixture.states as unknown[]).map((_, i) => {
    const f = facts.find((x) => x.stateId && stateIndexOf(x.stateId) === i);
    return f?.stateId ?? "";
  }),
).map((s, i) => ({ ...s, phase: context.statePhases[i] }));

const input = () => ({
  journey,
  context,
  steps,
  facts,
  transitions,
  productUrl: "https://yara.garden/",
  totalBudgetBase: BigInt(fixture.totalBudgetBase),
});

const ids = journey.checkpoints.map((c) => c.checkpointId);
/** cut the real journey in two: getting there, then the exchange */
const twoWay = [
  { checkpointIds: ids.slice(0, Math.max(1, ids.length - 2)), rewardWeight: 3, maxCompletions: 3 },
  { checkpointIds: ids.slice(Math.max(1, ids.length - 2)), rewardWeight: 7, maxCompletions: 3 },
];

const viewOf = (m: CandidateMission): MissionCoverageView => ({
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
});

describe("a one-group partition changes nothing", () => {
  it("is byte-identical to compiling the whole journey", () => {
    const one = compileGoalMission(input());
    const many = compileGoalMissions(input(), singleMissionPartition(ids).groups);
    expect(many.ok).toBe(true);
    if (!many.ok || !one.ok) return;
    expect(many.compiled).toHaveLength(1);
    expect(many.compiled[0]!.mission).toEqual(one.compiled.mission);
    expect(many.compiled[0]!.mission.missionKey).toBe("founder-goal-journey");
  });
});

describe("two segments, both compiled from real observations", () => {
  it("produces one mission per segment with distinct keys", () => {
    const r = compileGoalMissions(input(), twoWay);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compiled).toHaveLength(2);
    expect(new Set(r.compiled.map((c) => c.mission.missionKey)).size).toBe(2);
  });

  it("every criterion still cites evidence Sage actually observed", () => {
    const r = compileGoalMissions(input(), twoWay);
    if (!r.ok) return;
    const realFacts = new Set(facts.map((f) => f.id));
    const realTransitions = new Set(transitions.map((t) => t.id));
    for (const c of r.compiled) {
      const g = c.mission.groundingV1?.criteria ?? [];
      expect(g.length).toBeGreaterThan(0);
      for (const cr of g) {
        expect(cr.sourceFactIds.length).toBeGreaterThan(0);
        for (const f of cr.sourceFactIds) expect(realFacts.has(f)).toBe(true);
        for (const t of cr.sourceTransitionIds ?? []) expect(realTransitions.has(t)).toBe(true);
      }
    }
  });

  it("the SET still covers every checkpoint the founder asked for", () => {
    const r = compileGoalMissions(input(), twoWay);
    if (!r.ok) return;
    const cov = checkJourneyCoverage(journey, r.compiled.map((c) => viewOf(c.mission)));
    expect(cov.rejections).toEqual([]);
    expect(cov.ok).toBe(true);
    expect(cov.mappings).toHaveLength(journey.checkpoints.length);
  });

  it("no checkpoint is mapped by two missions", () => {
    const r = compileGoalMissions(input(), twoWay);
    if (!r.ok) return;
    const all = r.compiled.flatMap((c) => c.mappings.map((m) => m.checkpointId));
    expect(new Set(all).size).toBe(all.length);
  });

  it("a later segment tells the tester what comes before it", () => {
    const r = compileGoalMissions(input(), twoWay);
    if (!r.ok) return;
    expect(r.compiled[0]!.mission.instructions).not.toMatch(/^Before this:/);
    expect(r.compiled[1]!.mission.instructions).toMatch(/^Before this:/);
  });

  it("carries the model's weights and tester counts through", () => {
    const r = compileGoalMissions(input(), twoWay);
    if (!r.ok) return;
    expect(r.compiled.map((c) => c.mission.rewardWeight)).toEqual([3, 7]);
    expect(r.compiled.map((c) => Number(c.mission.maxCompletions))).toEqual([3, 3]);
  });
});

describe("the money still lands exactly", () => {
  it("allocates the whole budget across the segments, to the base unit", () => {
    const r = compileGoalMissions(input(), twoWay);
    if (!r.ok) return;
    const total = BigInt(fixture.totalBudgetBase);
    const alloc = allocateBudget(
      r.compiled.map((c) => ({
        missionKey: c.mission.missionKey,
        weight: c.mission.rewardWeight,
        suggestedMaxCompletions: Number(c.mission.maxCompletions),
        priority: c.mission.priority,
        effortMinutes: c.mission.effortMinutes,
      })),
      total,
    );
    expect(alloc.ok).toBe(true);
    const summed = alloc.missions.reduce(
      (s, m) => s + m.rewardBase * m.maxCompletions,
      BigInt(0),
    );
    expect(summed).toBe(total);
    for (const m of alloc.missions) expect(m.rewardBase >= MIN_REWARD_BASE).toBe(true);
  });
});

describe("a partition is abandoned rather than half-shipped", () => {
  it("an unknown checkpoint id fails the whole compile", () => {
    const r = compileGoalMissions(input(), [
      { checkpointIds: [ids[0]!] },
      { checkpointIds: ["not-a-real-checkpoint"] },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("partition_checkpoint_unknown");
  });

  it("an empty partition is refused", () => {
    const r = compileGoalMissions(input(), []);
    expect(r.ok).toBe(false);
  });
});

/**
 * REGRESSION — live plan os77wiEEexQb. The model split this journey three ways, all three proofs
 * verified, and then the canonical gate rejected the segment carrying the conversation for
 * `unanchored_claim`: every one of its eight cited facts was a decorative button ("·", "🔊", "+",
 * "−") with no letters in it. The two survivors no longer covered the founder's outcome, so the
 * whole plan was correctly blocked — a working single-mission plan turned into a dead end purely
 * because splitting thins each segment's evidence.
 *
 * A segment must be able to anchor itself. Anchors now scan every text a cited fact observed, and
 * fall back to text from the same STATES when a segment cites only decoration.
 */
describe("every segment can anchor itself, however finely the journey is cut", () => {
  const corpus = buildObservationCorpus([], {
    ran: true,
    startUrl: "https://yara.garden/",
    mode: "interactive",
    pages: [],
    states: fixture.states as never,
    classification: "",
    limitation: null,
    durationMs: 1,
  } as never);

  it("one mission per checkpoint still leaves every mission anchored", () => {
    const groups = ids.map((id) => ({ checkpointIds: [id] })).slice(0, 4);
    const r = compileGoalMissions(input(), groups);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const seg of r.compiled) {
      expect(seg.mission.anchors?.length ?? 0).toBeGreaterThan(0);
      // and every anchor is a literal substring of what Sage observed
      expect(anchorIssues(seg.mission, corpus)).toEqual([]);
    }
  });

  it("the two-way split is anchored too", () => {
    const r = compileGoalMissions(input(), twoWay);
    if (!r.ok) return;
    for (const seg of r.compiled) expect(anchorIssues(seg.mission, corpus)).toEqual([]);
  });
});
