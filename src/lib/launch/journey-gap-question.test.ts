import { describe, it, expect } from "vitest";
import { journeyGapQuestion, type GoalCheckpointV1 } from "./goal-journey";

/**
 * REGRESSION — production job VG3rEbj6LaKv (play2048.co, goal: "merge tiles until a 128 tile exists
 * and report the score"). Sage correctly refused to publish a plan it could not verify, and then
 * asked the founder FOUR copies of one unanswerable question:
 *
 *   "Sage could not complete this part of your request: Combine tiles through movement. Is there a
 *    path Sage should take (or does it need an account/permission) to reach it?"
 *
 * There is no path to hand over. Sage found the board and played it — it just cannot grind to a 128
 * tile in a bounded visit, and a criterion it cannot check is one it must not pay on. The founder
 * needs to hear THAT, and what to do about it.
 */

const cp = (over: Partial<GoalCheckpointV1>): GoalCheckpointV1 => ({
  checkpointId: "cp1",
  kind: "interaction",
  requirement: "Combine tiles through movement",
  targetEntity: "tiles",
  requiredContext: "",
  dependsOn: [],
  sourcePhrase: "",
  evidence: { factIds: [], transitionIds: [] },
  status: "unmet",
  ...over,
});

describe("an EFFORT gap is not an ACCESS gap", () => {
  it("asks for a verifiable goal when Sage found the thing but couldn't finish", () => {
    const q = journeyGapQuestion(cp({ entityIsObserved: true }));
    expect(q).toMatch(/found/i);
    expect(q).toMatch(/verify/i);
    // it must NOT ask for a path/permission it already has
    expect(q).not.toMatch(/account, invite, or permission/i);
    expect(q).toContain("Combine tiles through movement");
    expect(q).toContain("tiles");
  });

  it("asks where it is when Sage never found the thing", () => {
    const q = journeyGapQuestion(
      cp({ entityIsObserved: false, targetEntity: "admin dashboard" }),
    );
    expect(q).toMatch(/never found/i);
    expect(q).toMatch(/account, invite, or permission/i);
    expect(q).toContain("admin dashboard");
  });

  it("an unknown observation state is treated as findable, not as an access wall", () => {
    // entityIsObserved undefined (a journey compiled before binding) → do not accuse the founder
    // of hiding something behind a login.
    const q = journeyGapQuestion(cp({}));
    expect(q).toMatch(/couldn’t complete|couldn't complete/i);
  });

  it("reads naturally when the checkpoint names no entity", () => {
    for (const e of ["", "   ", undefined as unknown as string]) {
      const q = journeyGapQuestion(cp({ targetEntity: e, entityIsObserved: false }));
      expect(q).not.toMatch(/““|”””|“ ”/);
      expect(q).not.toContain("undefined");
      expect(q.length).toBeGreaterThan(30);
    }
  });

  it("never leaks an internal id to the founder", () => {
    const q = journeyGapQuestion(
      cp({ checkpointId: "cp2_a926e9f0", entityIsObserved: true }),
    );
    expect(q).not.toContain("cp2_a926e9f0");
    expect(q).not.toMatch(/fact-|transition-|_[0-9a-f]{8}/);
  });

  it("both questions end in a real question", () => {
    for (const observed of [true, false]) {
      expect(journeyGapQuestion(cp({ entityIsObserved: observed })).trim()).toMatch(/[?.]$/);
    }
  });
});
