import { describe, it, expect } from "vitest";
import {
  validateMissionPartition,
  singleMissionPartition,
  buildPartitionUser,
  MAX_MISSIONS,
} from "./mission-partition";
import type { GoalJourneyV1 } from "./goal-journey";

/**
 * The model decides how the journey divides. This is the gate that decides whether its answer is a
 * real partition — every checkpoint used exactly once, contiguous in dependency order, bounded.
 * Anything short of that is rejected, and the caller keeps the single whole-journey mission.
 */

const IDS = ["cp1", "cp2", "cp3", "cp4"];

describe("a partition is accepted only when it really is one", () => {
  it("accepts contiguous groups that tile the journey", () => {
    const p = validateMissionPartition(
      { groups: [{ checkpointIds: ["cp1", "cp2"] }, { checkpointIds: ["cp3", "cp4"] }] },
      IDS,
    );
    expect(p).not.toBeNull();
    expect(p!.groups.map((g) => g.checkpointIds)).toEqual([
      ["cp1", "cp2"],
      ["cp3", "cp4"],
    ]);
  });

  it("rejects a dropped checkpoint — the founder asked for all of them", () => {
    expect(
      validateMissionPartition({ groups: [{ checkpointIds: ["cp1", "cp2", "cp3"] }] }, IDS),
    ).toBeNull();
  });

  it("rejects a checkpoint used twice", () => {
    expect(
      validateMissionPartition(
        { groups: [{ checkpointIds: ["cp1", "cp2"] }, { checkpointIds: ["cp2", "cp3", "cp4"] }] },
        IDS,
      ),
    ).toBeNull();
  });

  it("rejects a non-contiguous group — a tester cannot skip a step they had to take", () => {
    expect(
      validateMissionPartition(
        { groups: [{ checkpointIds: ["cp1", "cp3"] }, { checkpointIds: ["cp2", "cp4"] }] },
        IDS,
      ),
    ).toBeNull();
  });

  it("rejects an invented checkpoint id", () => {
    expect(
      validateMissionPartition(
        { groups: [{ checkpointIds: ["cp1", "cp2"] }, { checkpointIds: ["cp3", "cp4", "cp9"] }] },
        IDS,
      ),
    ).toBeNull();
  });

  it("rejects more missions than a founder should read", () => {
    const many = Array.from({ length: MAX_MISSIONS + 1 }, (_, i) => ({
      checkpointIds: [`c${i}`],
    }));
    const ids = many.map((g) => g.checkpointIds[0]!);
    expect(validateMissionPartition({ groups: many }, ids)).toBeNull();
  });

  it("rejects an empty group and an empty proposal", () => {
    expect(validateMissionPartition({ groups: [{ checkpointIds: [] }] }, IDS)).toBeNull();
    expect(validateMissionPartition({ groups: [] }, IDS)).toBeNull();
    expect(validateMissionPartition(null, IDS)).toBeNull();
    expect(validateMissionPartition({ groups: [{ checkpointIds: IDS }] }, [])).toBeNull();
  });
});

describe("the model's ordering is never trusted", () => {
  it("re-derives ids and group order from the journey, not from the reply", () => {
    const p = validateMissionPartition(
      {
        groups: [
          { checkpointIds: ["cp4", "cp3"] }, // reversed, and listed first
          { checkpointIds: ["cp2", "cp1"] },
        ],
      },
      IDS,
    );
    expect(p!.groups.map((g) => g.checkpointIds)).toEqual([
      ["cp1", "cp2"],
      ["cp3", "cp4"],
    ]);
  });

  it.each([
    ["snake_case ids", { groups: [{ checkpoint_ids: IDS }] }],
    ["missions[] instead of groups[]", { missions: [{ checkpoints: IDS }] }],
    ["partition[] with ids[]", { partition: [{ ids: IDS }] }],
    ["a bare top-level array", [{ checkpointIds: IDS }]],
  ])("reads %s", (_label, raw) => {
    const p = validateMissionPartition(raw, IDS);
    expect(p).not.toBeNull();
    expect(p!.groups[0]!.checkpointIds).toEqual(IDS);
  });

  it("reads a single id given as a bare string", () => {
    const p = validateMissionPartition({ groups: [{ checkpointIds: "only" }] }, ["only"]);
    expect(p!.groups[0]!.checkpointIds).toEqual(["only"]);
  });
});

describe("weights and tester counts are clamped, never taken raw", () => {
  it("clamps out-of-range numbers and defaults the missing ones", () => {
    const p = validateMissionPartition(
      {
        groups: [
          { checkpointIds: ["cp1", "cp2"], rewardWeight: 99, maxCompletions: -4 },
          { checkpointIds: ["cp3", "cp4"] },
        ],
      },
      IDS,
    );
    expect(p!.groups[0]!.rewardWeight).toBe(10);
    expect(p!.groups[0]!.maxCompletions).toBe(1);
    expect(p!.groups[1]!.rewardWeight).toBe(5);
    expect(p!.groups[1]!.maxCompletions).toBe(1);
  });

  it("keeps a sensible proposal intact", () => {
    const p = validateMissionPartition(
      {
        groups: [
          { checkpointIds: ["cp1", "cp2"], rewardWeight: 3, maxCompletions: 3 },
          { checkpointIds: ["cp3", "cp4"], rewardWeight: 8, maxCompletions: 2 },
        ],
      },
      IDS,
    );
    expect(p!.groups.map((g) => [g.rewardWeight, g.maxCompletions])).toEqual([
      [3, 3],
      [8, 2],
    ]);
  });
});

describe("the fallback and the prompt", () => {
  it("the single-mission fallback covers the whole journey", () => {
    const p = singleMissionPartition(IDS);
    expect(p.groups).toHaveLength(1);
    expect(p.groups[0]!.checkpointIds).toEqual(IDS);
  });

  it("the prompt carries requirements and ids but no evidence to cite", () => {
    const journey = {
      goal: "walk in and talk to her",
      checkpoints: IDS.map((id, i) => ({
        checkpointId: id,
        requirement: `step ${i + 1}`,
        evidence: { factIds: [`fact-${i}`], transitionIds: [`tr-${i}`] },
      })),
    } as unknown as GoalJourneyV1;
    const user = buildPartitionUser(journey);
    expect(user).toContain("walk in and talk to her");
    expect(user).toContain("cp1");
    expect(user).toContain("step 1");
    // the model has no business citing evidence, so it is never shown any
    expect(user).not.toContain("fact-0");
    expect(user).not.toContain("tr-0");
  });
});
