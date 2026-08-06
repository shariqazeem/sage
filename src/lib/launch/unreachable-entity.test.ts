import { describe, expect, it } from "vitest";

import {
  actionEntityUnreachable,
  isConcreteEntity,
  evaluateJourney,
  type GoalCheckpointV1,
  type GoalJourneyV1,
} from "./goal-journey";

/**
 * SAGE CANNOT WITNESS AN ACTION ON SOMETHING IT NEVER SAW.
 *
 * `entityIsObserved: false` exists for a good reason: a journey compiler names concepts ("the main
 * area", "the onboarding") that no product label contains, and demanding a text match on those would
 * make perfectly reasonable checkpoints unsatisfiable. For REACHING a place that is fair.
 *
 * For an ACTION it was a disaster, because the entity check was skipped entirely and the checkpoint
 * then completed on any click that changed the view. Measured on clawup.org — a marketing site with
 * four pages and no purchase surface anywhere on it — the goal "testers must purchase credits and
 * launch an agent" compiled to nine checkpoints and Sage marked ALL NINE observed, including:
 *
 *   interaction  observed  Complete the purchase of credits using personal funds.
 *   outcome      observed  The agent is successfully launched and running.
 *
 * It had bought nothing and launched nothing. The journey looked complete, so the gate had no
 * objection to raise, and the plan that came back for a $400 budget was about the logo.
 */

const cp = (over: Partial<GoalCheckpointV1> = {}): GoalCheckpointV1 => ({
  checkpointId: "c1",
  kind: "interaction",
  requirement: "Complete the purchase of credits using personal funds.",
  targetEntity: "credits",
  requiredContext: "",
  dependsOn: [],
  sourcePhrase: "purchasing credits",
  evidence: { factIds: [], transitionIds: [] },
  status: "unmet",
  entityIsObserved: false,
  ...over,
});

describe("telling a thing from a concept", () => {
  it.each(["credits", "checkout", "the dashboard", "Yara", "billing portal"])(
    "%s is a concrete thing a product would show",
    (e) => expect(isConcreteEntity(e)).toBe(true),
  );

  it.each([
    "the world",
    "the experience",
    "onboarding",
    "the app",
    "the page",
    "it",
    "",
    "a",
  ])("%p is a concept, not a label", (e) => expect(isConcreteEntity(e)).toBe(false));
});

describe("an action on something never seen is unreachable", () => {
  it("blocks the clawup purchase checkpoint", () => {
    expect(actionEntityUnreachable(cp())).toBe(true);
  });

  it("blocks the outcome that depends on it", () => {
    expect(
      actionEntityUnreachable(
        cp({ kind: "outcome", requirement: "The agent is running.", targetEntity: "agent dashboard" }),
      ),
    ).toBe(true);
  });

  it("does NOT block when the product actually shows the thing", () => {
    // yara.garden really does display "Yara" — the ordinary path must be untouched.
    expect(actionEntityUnreachable(cp({ targetEntity: "Yara", entityIsObserved: true }))).toBe(false);
  });

  it("does NOT block a concept entity — that is what the flag was built for", () => {
    expect(actionEntityUnreachable(cp({ targetEntity: "the world" }))).toBe(false);
  });

  it("does NOT block navigation or state — reaching a place is legitimately fuzzy", () => {
    for (const kind of ["navigation", "state", "experience", "entry", "input"] as const) {
      expect(actionEntityUnreachable(cp({ kind }))).toBe(false);
    }
  });
});

describe("the journey walk reports it honestly", () => {
  const journey = (checkpoints: GoalCheckpointV1[]): GoalJourneyV1 => ({
    version: "goal-journey-v1" as GoalJourneyV1["version"],
    goal: "testers must purchase credits and launch an agent",
    checkpoints,
    digest: "d",
    model: null,
    provider: null,
  });

  /** A step that would previously have satisfied anything: a real click that changed the view. */
  const step = {
    actionKind: "click" as const,
    stateText: "clawup brand assets logo safety zone",
    addedText: "logo safety zone",
    actedLabel: "Brand assets",
    observableChange: true,
    factIds: ["f1"],
    transitionId: "t1",
    phase: undefined,
    actedEntityId: undefined,
  };

  it("marks it blocked with a reason instead of observed", () => {
    const r = evaluateJourney(journey([cp()]), [step as never]);
    const out = r.checkpoints[0]!;
    expect(out.status).toBe("blocked");
    expect(out.blockedReason).toBe("entity_never_observed");
  });

  it("never claims evidence for something it did not witness", () => {
    const r = evaluateJourney(journey([cp()]), [step as never]);
    expect(r.checkpoints[0]!.evidence.factIds).toEqual([]);
    expect(r.checkpoints[0]!.evidence.transitionIds).toEqual([]);
  });

  it("a later checkpoint cannot leapfrog the blocked one", () => {
    // The walk is sequential, so an unreachable step stops the journey rather than letting the
    // outcome be satisfied by something unrelated further along.
    const r = evaluateJourney(
      journey([
        cp({ checkpointId: "c1" }),
        cp({ checkpointId: "c2", kind: "outcome", dependsOn: ["c1"], targetEntity: "running agent" }),
      ]),
      [step as never, step as never],
    );
    expect(r.checkpoints.every((c) => c.status !== "observed")).toBe(true);
  });

  it("leaves an ordinary observable journey completely alone", () => {
    const ok = cp({
      kind: "interaction",
      targetEntity: "Brand assets",
      entityIsObserved: true,
    });
    const r = evaluateJourney(journey([ok]), [step as never]);
    expect(r.checkpoints[0]!.status).toBe("observed");
    expect(r.checkpoints[0]!.evidence.factIds).toEqual(["f1"]);
  });
});
