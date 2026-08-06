import { describe, it, expect } from "vitest";
import { describeJourneyWall } from "./goal-journey";
import type { GoalCheckpointV1 } from "./goal-journey";

/**
 * REGRESSION — production job `-2kfyIiAeDBc` (sagepays.xyz, $50). Sage browsed the product, found
 * the inspection feature, and then dead-ended with `needs_input` because it could not personally
 * FINISH the flow inside one visit. The founder was asked to restate a goal they had stated plainly.
 *
 * The partial-plan path existed but only fired when every unmet checkpoint was an ACCESS wall
 * (`entityIsObserved === false`). "Found it, couldn't finish it" is the other wall, and it fell
 * through to the dead end. Both now yield a plan for the observed part, with the boundary named in
 * the terms that are true of it — Sage's own limits, not a verdict on whether the work is testable.
 */

const cp = (
  requirement: string,
  entityIsObserved: boolean,
): GoalCheckpointV1 =>
  ({
    id: requirement.slice(0, 8),
    kind: "interaction",
    requirement,
    targetEntity: "product testing inspection",
    entityIsObserved,
    status: "unmet",
    required: true,
  }) as unknown as GoalCheckpointV1;

describe("an effort wall reads as time, not permission", () => {
  const wall = describeJourneyWall([
    cp("Locate and initiate the product testing inspection feature.", true),
    cp("The product testing inspection process is successfully started.", true),
  ]);

  it("does not claim Sage lacked an account or wallet", () => {
    expect(wall.boundary).not.toMatch(/account|wallet|permission/i);
  });

  it("says the honest thing: it takes longer than one visit", () => {
    expect(wall.boundary).toMatch(/longer than one visit/i);
  });

  it("names the checkpoints so the founder can see what was left", () => {
    expect(wall.unreachable).toEqual([
      "Locate and initiate the product testing inspection feature",
      "The product testing inspection process is successfully started",
    ]);
  });
});

describe("an access wall still reads as permission", () => {
  const wall = describeJourneyWall([
    cp("Connect a wallet and approve the campaign.", false),
  ]);

  it("names the missing permission", () => {
    expect(wall.boundary).toMatch(/account, wallet or permission/i);
  });

  it("does not blame the clock", () => {
    expect(wall.boundary).not.toMatch(/longer than one visit/i);
  });
});

describe("a mixed journey names both walls", () => {
  const wall = describeJourneyWall([
    cp("Connect a wallet.", false),
    cp("Start an inspection and wait for the plan.", true),
  ]);

  it("reports each wall in its own terms", () => {
    expect(wall.boundary).toMatch(/account, wallet or permission/i);
    expect(wall.boundary).toMatch(/longer than one visit/i);
    expect(wall.boundary).toMatch(/, and /);
  });
});

describe("the founder never gets an unbounded wall of text", () => {
  const many = Array.from({ length: 9 }, (_, i) =>
    cp(`Requirement number ${i}.`, i % 2 === 0),
  );
  const wall = describeJourneyWall(many);

  it("caps the named checkpoints", () => {
    expect(wall.unreachable).toHaveLength(4);
  });

  it("caps each side of the boundary at three", () => {
    expect(wall.boundary.match(/Requirement number/g)?.length).toBe(6);
  });
});

describe("trailing punctuation is not doubled into the sentence", () => {
  it("strips the period the checkpoint already carries", () => {
    const wall = describeJourneyWall([cp("Start an inspection.", true)]);
    expect(wall.unreachable).toEqual(["Start an inspection"]);
    expect(wall.boundary).not.toMatch(/\.\)/);
  });
});

describe("the wall comes with a way through it", () => {
  const cp = (over: Partial<GoalCheckpointV1> = {}): GoalCheckpointV1 => ({
    checkpointId: "c1",
    kind: "interaction",
    requirement: "Purchase credits using personal funds",
    targetEntity: "credits",
    requiredContext: "",
    dependsOn: [],
    sourcePhrase: "purchase credits",
    evidence: { factIds: [], transitionIds: [] },
    status: "unmet",
    entityIsObserved: false,
    ...over,
  });

  it("an ACCESS wall asks for the one thing that would open it", () => {
    // Naming the wall well is not the same as telling someone how to open it. The message described
    // every unfinished part and separated access from effort, then left the founder nothing to do.
    const r = describeJourneyWall([cp()]);
    expect(r.unblockAsk).toBeTruthy();
    expect(r.unblockAsk).toMatch(/demo account|invite code|public URL/i);
  });

  it("an EFFORT wall asks for nothing, because nothing they send would help", () => {
    // Sage found it and ran out of visit. No credential fixes that, so inventing an ask would be
    // noise dressed as helpfulness.
    const r = describeJourneyWall([cp({ entityIsObserved: true })]);
    expect(r.unblockAsk).toBeNull();
  });

  it("a mixed wall still asks, because the access half is real", () => {
    const r = describeJourneyWall([cp(), cp({ checkpointId: "c2", entityIsObserved: true })]);
    expect(r.unblockAsk).toBeTruthy();
  });
});
