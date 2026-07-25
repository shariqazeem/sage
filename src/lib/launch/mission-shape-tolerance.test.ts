import { describe, it, expect } from "vitest";
import { coerceMission } from "./mission-brain";

/**
 * REGRESSION — a real production failure (job PYQtUaSRdQ0v, play2048.co, 2026-07-25): Sage explored
 * the product perfectly (12 states, 32 facts, 11 transitions) and then failed the whole inspection
 * with `schema_mismatch`, because the model returned `instructions` as a LIST of numbered steps
 * instead of one string. `coerceMission` dropped every candidate, five attempts in a row — the model
 * has a per-prompt bias, so retrying with a different temperature does not rescue it.
 *
 * The founder's product was fine. The plan was fine. Sage threw it away over punctuation.
 *
 * These are the shapes the live model actually emits for the same prompt (both reproduced against
 * the production gateway at temperature 0.3 and 0.15).
 */

/** the exact array-shaped payload the live model returned at temperature 0.3 */
const listShaped = {
  missionKey: "reach-128-tile",
  title: "Reach the 128 Tile Milestone",
  objective:
    "Start a new game and play until a 128 tile appears on the board to verify the scoring and progression mechanics.",
  instructions: [
    "1. Navigate to https://play2048.co/",
    "2. Click the 'N or R New Game' button to ensure a fresh board state.",
    "3. Use your keyboard arrow keys to merge tiles.",
    "4. Continue playing until a tile with the number '128' appears on the grid.",
    "5. Note the final score displayed in the 'SCORE' container at the moment the 128 tile is created.",
  ],
  targetSurface: "https://play2048.co/",
  criteria: ["The tester must reach the 128 tile state."],
  evidenceRequirements: ["A screenshot showing the 128 tile and the score."],
  anchors: ["New Game", "SCORE"],
};

/** the string-shaped payload the SAME prompt returned at temperature 0.15 */
const stringShaped = {
  ...listShaped,
  instructions:
    "1. Navigate to https://play2048.co/. 2. Click 'New Game' to ensure a fresh board. 3. Use arrow keys to merge tiles until a tile with the value '128' appears on the grid.",
};

describe("a mission survives either shape the model emits", () => {
  it("accepts list-shaped instructions and keeps every step, in order", () => {
    const m = coerceMission(listShaped, 0);
    expect(m).not.toBeNull();
    expect(m!.instructions).toContain("Navigate to https://play2048.co/");
    expect(m!.instructions).toContain("128");
    // order preserved, one step per line
    expect(m!.instructions.split("\n")).toHaveLength(5);
    expect(m!.instructions.split("\n")[0]).toMatch(/^1\./);
  });

  it("accepts string-shaped instructions exactly as before", () => {
    const m = coerceMission(stringShaped, 0);
    expect(m).not.toBeNull();
    expect(m!.instructions).toBe(stringShaped.instructions);
  });

  it("both shapes produce the same mission identity", () => {
    expect(coerceMission(listShaped, 0)!.missionKey).toBe(
      coerceMission(stringShaped, 0)!.missionKey,
    );
  });

  it("reads steps given as objects, the third shape models emit", () => {
    const m = coerceMission(
      {
        ...listShaped,
        instructions: [
          { step: 1, text: "Open the board" },
          { step: 2, text: "Merge until 128" },
        ],
      },
      0,
    );
    expect(m!.instructions).toBe("Open the board\nMerge until 128");
  });

  it("a list field given as a single unwrapped item is still a list", () => {
    const m = coerceMission({ ...listShaped, criteria: "The 128 tile is visible." }, 0);
    expect(m!.criteria).toEqual(["The 128 tile is visible."]);
  });

  it("a bare url is read as a page citation", () => {
    const m = coerceMission({ ...listShaped, sources: ["https://play2048.co/"] }, 0);
    expect(m!.sources).toEqual([
      { kind: "page", ref: "https://play2048.co/", observation: "" },
    ]);
  });

  it("{url} is read as {ref} — the same citation by another name", () => {
    const m = coerceMission(
      { ...listShaped, sources: [{ kind: "page", url: "https://play2048.co/", observation: "board" }] },
      0,
    );
    expect(m!.sources[0]!.ref).toBe("https://play2048.co/");
  });
});

describe("tolerance does not become gullibility", () => {
  it("a mission with no usable instructions is still rejected", () => {
    expect(coerceMission({ ...listShaped, instructions: [] }, 0)).toBeNull();
    expect(coerceMission({ ...listShaped, instructions: ["", "   "] }, 0)).toBeNull();
    expect(coerceMission({ ...listShaped, instructions: null }, 0)).toBeNull();
    expect(coerceMission({ ...listShaped, instructions: {} }, 0)).toBeNull();
  });

  it("every required field is still required", () => {
    for (const k of ["title", "objective", "targetSurface"] as const) {
      expect(coerceMission({ ...listShaped, [k]: "" }, 0)).toBeNull();
      expect(coerceMission({ ...listShaped, [k]: undefined }, 0)).toBeNull();
    }
  });

  it("nothing is invented — empty lists stay empty", () => {
    const m = coerceMission({ ...listShaped, criteria: [], anchors: undefined }, 0);
    expect(m!.criteria).toEqual([]);
    expect(m!.anchors).toEqual([]);
  });

  it("junk items are dropped, not stringified into noise", () => {
    const m = coerceMission({ ...listShaped, criteria: [null, {}, [], "real one"] }, 0);
    expect(m!.criteria).toEqual(["real one"]);
  });

  it("long fields are still bounded", () => {
    const m = coerceMission(
      { ...listShaped, instructions: Array.from({ length: 400 }, () => "x".repeat(60)) },
      0,
    );
    expect(m!.instructions.length).toBeLessThanOrEqual(6000);
  });
});
