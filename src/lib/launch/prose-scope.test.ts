import { describe, it, expect } from "vitest";
import { mentionsForeignScope, applyProseRefinement } from "./goal-mission-compiler";
import type { CandidateMission } from "./schemas";

/**
 * REGRESSION — live plan X5Asl18STpZ3. The journey was split in two, and the model retitled the
 * segment whose ONLY criterion was "navigate to the site and enter the garden" as
 * "Explore the Garden and Chat with Yara". A tester would have gone and chatted, then found the
 * mission never asked for it: wasted effort, and evidence the judge has no criterion to match.
 *
 * Refined copy may polish what a mission says. It may not promise another segment's work.
 */

const base = {
  missionKey: "founder-goal-part-1",
  title: "Reach the garden and have a real exchange",
  objective: "Navigate to the website url and enter the virtual garden space.",
  instructions: "1. Navigate to the site.\n2. Enter the garden.",
  criteria: ["Navigate to the website url and enter the virtual garden space"],
  whyItMatters: "the founder asked for it",
} as unknown as CandidateMission;

describe("copy may not promise another segment's work", () => {
  it("catches the live failure: a title that adds the later segment's target", () => {
    const own = [base.title, base.objective, base.instructions, ...base.criteria].join(" ");
    expect(mentionsForeignScope("Explore the Garden and Chat with Yara", own, ["Yara.", "conversation"])).toBe(true);
  });

  it("allows copy that stays inside this mission's own steps", () => {
    const own = [base.title, base.objective, base.instructions, ...base.criteria].join(" ");
    expect(mentionsForeignScope("Get into the walkable garden", own, ["Yara.", "conversation"])).toBe(false);
  });

  it("never treats a term this mission legitimately covers as foreign", () => {
    // the segment that DOES contain Yara may of course say Yara
    const own = "Locate the yara character and send her a message";
    expect(mentionsForeignScope("Meet Yara and say hello", own, ["Yara"])).toBe(false);
  });

  it("ignores terms too short to be distinctive", () => {
    expect(mentionsForeignScope("anything at all", "own text", ["a", "in", "of"])).toBe(false);
  });
});

describe("the guard falls back to the compiled copy, never to nothing", () => {
  it("keeps the deterministic title when the refinement overreaches", () => {
    const merged = applyProseRefinement(
      base,
      {
        title: "Explore the Garden and Chat with Yara",
        objective: "Walk in and talk to Yara about anything.",
        instructions: "1. Go in. 2. Chat with Yara.",
        whyItMatters: "so newcomers can hold a conversation",
      },
      ["Yara"],
    );
    expect(merged.title).toBe(base.title);
    expect(merged.objective).toBe(base.objective);
    expect(merged.instructions).toBe(base.instructions);
    // and nothing structural moved
    expect(merged.criteria).toEqual(base.criteria);
  });

  it("still accepts an in-scope refinement", () => {
    const merged = applyProseRefinement(
      base,
      {
        title: "Get inside the walkable garden",
        objective: "Open the site and step into the garden itself.",
      },
      ["Yara"],
    );
    expect(merged.title).toBe("Get inside the walkable garden");
    expect(merged.objective).toBe("Open the site and step into the garden itself.");
  });

  it("with no foreign terms it behaves exactly as before", () => {
    const merged = applyProseRefinement(base, {
      title: "Explore the Garden and Chat with Yara",
    });
    expect(merged.title).toBe("Explore the Garden and Chat with Yara");
  });
});
