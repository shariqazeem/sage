import { describe, it, expect } from "vitest";
import {
  bindJourneyToContext,
  evaluateJourney,
  buildJourneySteps,
  requiredPhaseFor,
  checkJourneyCoverage,
  type GoalJourneyV1,
  type JourneyStep,
  type MissionCoverageView,
} from "./goal-journey";
import { compileGoalMission } from "./goal-mission-compiler";
import type { ProductContextV1 } from "./product-context";
import type { ObservedFactV1, ActionTransitionV1 } from "./observed-facts";
import fixture from "./__fixtures__/yara-clarified-run.json";

/**
 * REGRESSION — the founder answered Sage's question and Sage came back asking about four steps it had
 * ACTUALLY performed (job eCQY-jQy_EEZ: the browser completed the whole journey, yet 6 of 7 checkpoints
 * were `unmet`). Two general defects caused it:
 *
 *   A. a checkpoint that IS a lifecycle stage ("complete the onboarding") was given
 *      requiredPhase = main_experience — unsatisfiable by construction, and every later checkpoint
 *      stalled behind it in dependency order;
 *   B. the phase FLOOR was applied to every entity checkpoint, though its only job is to stop an
 *      EARLIER-phase homonym (a name on the intro screen) from standing in for the real occurrence.
 *
 * This replays that exact production run offline (zero provider calls).
 */

const journey = fixture.goalJourney as unknown as GoalJourneyV1;
const context = fixture.productContext as unknown as ProductContextV1;
const facts = fixture.observations.facts as unknown as ObservedFactV1[];
const transitions = fixture.observations
  .transitions as unknown as ActionTransitionV1[];

const steps: JourneyStep[] = buildJourneySteps(
  fixture.states as never,
  facts,
  transitions,
  (fixture.states as unknown[]).map((_, i) => {
    const e = context.entities.find((x) => x.stateIndex === i);
    return e?.stateId ?? "";
  }),
).map((s, i) => ({ ...s, phase: context.statePhases[i] }));

const evaluated = () =>
  evaluateJourney(bindJourneyToContext(journey, context).journey, steps);

describe("A — a lifecycle checkpoint is required IN its own stage", () => {
  it("'complete the onboarding' is an onboarding requirement, not a post-onboarding one", () => {
    const onboardingCp = journey.checkpoints.find((c) =>
      /onboarding/i.test(c.requirement),
    )!;
    expect(onboardingCp).toBeTruthy();
    const idx = journey.checkpoints.indexOf(onboardingCp);
    expect(requiredPhaseFor(onboardingCp, idx)).toBe("onboarding");
  });

  it("other lifecycle wordings resolve the same way, whatever the product", () => {
    const cp = (requirement: string, targetEntity = "") => ({
      checkpointId: "x",
      kind: "experience" as const,
      requirement,
      targetEntity,
      requiredContext: "",
      dependsOn: [],
      sourcePhrase: "",
      evidence: { factIds: [], transitionIds: [] },
      status: "unmet" as const,
    });
    for (const r of [
      "Complete the sign-up flow",
      "Finish the tutorial",
      "Get through the intro",
      "Pass the welcome walkthrough",
      "Complete registration",
    ]) {
      expect(requiredPhaseFor(cp(r), 1)).toBe("onboarding");
    }
    // a genuine in-world requirement is unaffected
    expect(requiredPhaseFor(cp("Locate the guide character", "guide"), 3)).toBe(
      "main_experience",
    );
  });
});

describe("B — the phase floor only guards an earlier-phase homonym", () => {
  it("keeps the floor for an entity that ALSO appears earlier (the real guarantee)", () => {
    const bound = bindJourneyToContext(journey, context).journey;
    const yaraCp = bound.checkpoints.find((c) =>
      /yara character/i.test(c.targetEntity),
    );
    if (yaraCp) {
      // "Yara" appears on the intro screen too → the floor must stay at the main experience
      expect(yaraCp.requiredPhase).toBe("main_experience");
    }
  });

  it("relaxes the floor for an entity with no earlier occurrence (ordering still enforced by deps)", () => {
    const bound = bindJourneyToContext(journey, context).journey;
    const convo = bound.checkpoints.find((c) =>
      /conversation/i.test(c.targetEntity),
    );
    if (convo) expect(convo.requiredPhase).toBe("entry"); // no homonym → no artificial floor
  });
});

describe("the production run now completes end to end", () => {
  it("every checkpoint the browser performed is OBSERVED (was 1 of 7)", () => {
    const j = evaluated();
    const statuses = j.checkpoints.map((c) => c.status);
    expect(statuses.filter((s) => s === "observed").length).toBe(
      j.checkpoints.length,
    );
    // and the send/receive pair still carries DISTINCT evidence
    const send = j.checkpoints.find((c) => c.kind === "input");
    const recv = j.checkpoints.find((c) => c.kind === "outcome");
    if (send && recv)
      expect(recv.evidence.factIds).not.toEqual(send.evidence.factIds);
  });

  it("compiles a grounded mission that passes the unchanged coverage gate", () => {
    const j = evaluated();
    const r = compileGoalMission({
      journey: j,
      context,
      steps,
      facts,
      transitions,
      productUrl: "https://yara.garden/",
      totalBudgetBase: BigInt(fixture.totalBudgetBase),
    });
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
    const cov = checkJourneyCoverage(j, [view]);
    expect(cov.rejections).toEqual([]);
    expect(cov.ok).toBe(true);
    expect(cov.mappings).toHaveLength(j.checkpoints.length);
  });

  it("asks the founder NOTHING when it completed the journey", () => {
    const bound = bindJourneyToContext(journey, context);
    expect(bound.question).toBeNull();
    const j = evaluated();
    expect(j.checkpoints.filter((c) => c.status !== "observed")).toHaveLength(0);
  });
});
