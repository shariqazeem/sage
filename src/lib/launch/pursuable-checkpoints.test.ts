import { describe, it, expect } from "vitest";
import { pursuableCheckpoints, nextUnmetCheckpoint } from "./goal-journey";
import type { GoalJourneyV1, GoalCheckpointV1 } from "./goal-journey";

/**
 * THE DEAD-END. Measured on sagepays.xyz (2026-08-15): the goal was "start the inspection, then open
 * the Feedback button". The inspection takes five minutes against a three-minute browsing budget, so
 * its checkpoint could never be marked observed — and the feedback checkpoint, whose button was in
 * the harvested elements of every single screen, was never even considered. The grounded architect
 * wrote the right mission and the compiler correctly threw it away
 * (`action_missing_after_state_fact`), because Sage had never performed the click.
 */
const cp = (id: string, entity: string, status: GoalCheckpointV1["status"], dependsOn: string[] = []): GoalCheckpointV1 =>
  ({ checkpointId: id, targetEntity: entity, requiredContext: null, status, dependsOn }) as unknown as GoalCheckpointV1;

const journey = (checkpoints: GoalCheckpointV1[]): GoalJourneyV1 =>
  ({ checkpoints }) as unknown as GoalJourneyV1;

describe("pursuableCheckpoints", () => {
  it("returns the ordered unmet checkpoints — the first is still what nextUnmetCheckpoint picks", () => {
    const j = journey([cp("c1", "inspection", "unmet"), cp("c2", "feedback", "unmet")]);
    expect(pursuableCheckpoints(j).map((c) => c.targetEntity)).toEqual(["inspection", "feedback"]);
    expect(nextUnmetCheckpoint(j)?.targetEntity).toBe("inspection");
  });

  it("the stuck-inspection case: feedback is reachable as a FALLBACK, never as the first choice", () => {
    const j = journey([cp("c1", "inspection", "unmet"), cp("c2", "feedback", "unmet")]);
    const fallbacks = pursuableCheckpoints(j).slice(1);
    expect(fallbacks.map((c) => c.targetEntity)).toEqual(["feedback"]);
  });

  it("never offers a checkpoint whose dependency is unobserved — ordering still holds", () => {
    const j = journey([cp("c1", "signup", "unmet"), cp("c2", "dashboard", "unmet", ["c1"])]);
    expect(pursuableCheckpoints(j).map((c) => c.targetEntity)).toEqual(["signup"]);
  });

  it("skips checkpoints already observed", () => {
    const j = journey([cp("c1", "signup", "observed"), cp("c2", "dashboard", "unmet", ["c1"]), cp("c3", "feedback", "unmet")]);
    expect(pursuableCheckpoints(j).map((c) => c.targetEntity)).toEqual(["dashboard", "feedback"]);
  });

  it("no journey → nothing to pursue (the pre-journey path is unchanged)", () => {
    expect(pursuableCheckpoints(null)).toEqual([]);
  });
});
