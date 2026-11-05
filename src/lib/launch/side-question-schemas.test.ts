import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PARTITION_TRANSPORT_SCHEMA, validateMissionPartition } from "./mission-partition";
import { PROSE_REFINEMENT_TRANSPORT_SCHEMA } from "./mission-grounding-shadow";
import { applyProseRefinement } from "./goal-mission-compiler";
import type { CandidateMission } from "./schemas";

/**
 * THE GROUNDED PLANNER'S SIDE QUESTIONS ASK IN THEIR OWN SHAPE (5 Nov 2026).
 *
 * The journey partition and the prose polish went through the architect, which sends the semantic-draft
 * schema. Measured live on Claude (strict json_schema honoured): both answers came back as
 * {"missions":[…]}, the partition was invalid so every journey shipped as ONE mission, and the polish was
 * dropped so the compiler's fallback copy shipped ("Reach core experience and have a real exchange" on a
 * 2048 game). With their own schemas: {"groups":[…]} in 2 groups, and a real title.
 */

/** Strict json_schema (Anthropic, OpenAI) wants every object closed and every property required. */
function assertStrict(node: unknown, path = "$"): void {
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (o.type === "object") {
    expect(o.additionalProperties, `${path}.additionalProperties`).toBe(false);
    const props = Object.keys((o.properties ?? {}) as object).sort();
    expect([...((o.required ?? []) as string[])].sort(), `${path}.required`).toEqual(props);
    for (const [k, v] of Object.entries((o.properties ?? {}) as object)) assertStrict(v, `${path}.${k}`);
  }
  if (o.type === "array") assertStrict(o.items, `${path}[]`);
}

describe("the side questions' own schemas", () => {
  it("are strict-compatible", () => {
    assertStrict(PARTITION_TRANSPORT_SCHEMA.schema);
    assertStrict(PROSE_REFINEMENT_TRANSPORT_SCHEMA.schema);
  });

  it("an answer in the partition schema is a valid partition (Claude's live answer, 5 Nov)", () => {
    const answer = { groups: [{ checkpointIds: ["cp-signup"], rewardWeight: 3, maxCompletions: 5 }, { checkpointIds: ["cp-project", "cp-invite"], rewardWeight: 7, maxCompletions: 3 }] };
    const v = validateMissionPartition(answer, ["cp-signup", "cp-project", "cp-invite"]);
    expect(v).not.toBeNull();
    expect(JSON.stringify(v)).toContain("cp-invite");
  });

  it("an answer in the draft schema is NOT a partition: the defect this fixes", () => {
    const borrowed = { missions: [{ missionKey: "cp-signup", title: "Create an account", objective: "o", instructions: "i" }] };
    expect(validateMissionPartition(borrowed, ["cp-signup", "cp-project", "cp-invite"])).toBeNull();
  });

  it("an answer in the prose schema replaces the template copy", () => {
    const mission = { title: "Reach core experience and have a real exchange", objective: "Complete the founder's journey end to end: reach the board.", instructions: "1. Open the game.\n2. Merge two tiles.", criteria: ["The tester reaches the game board and merges two tiles"], whyItMatters: "" } as unknown as CandidateMission;
    const polished = applyProseRefinement(mission, { title: "Play your first merge on the game board", objective: "Open the game, get to the board, and merge two tiles.", whyItMatters: "A new player should reach a first merge unaided.", instructions: "1. Open the game.\n2. Merge two tiles." });
    expect(polished.title).toBe("Play your first merge on the game board");
  });

  it("production sends each side question with its own schema, never the draft's", () => {
    const src = readFileSync(join(__dirname, "mission-grounding-shadow.ts"), "utf8");
    expect(src).toMatch(/ask\(PROSE_REFINEMENT_TRANSPORT_SCHEMA,/);
    expect(src).toMatch(/ask\(PARTITION_TRANSPORT_SCHEMA,/);
    expect(src).toMatch(/await partitioner\(\s*PARTITION_SYSTEM/);
    expect(src).toMatch(/const prose = await polish\(/);
    expect(src).not.toMatch(/await architect\(\s*PARTITION_SYSTEM/);
  });
});
