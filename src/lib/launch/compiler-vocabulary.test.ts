import { describe, it, expect } from "vitest";
import { compileGoalMission } from "./goal-mission-compiler";
import {
  buildJourneySteps,
  type GoalJourneyV1,
  type JourneyStep,
} from "./goal-journey";
import type { ProductContextV1 } from "./product-context";
import type { ObservedFactV1, ActionTransitionV1 } from "./observed-facts";
import fixture from "./__fixtures__/yara-production-run.json";

/**
 * REGRESSION — production job 6sLshxc8QnaR (excalidraw.com, goal "draw one rectangle and confirm it
 * appears"). Sage produced a correct grounded plan whose criterion read:
 *
 *   "…a NEW response from "Rectangle" that was not on screen before the message was sent"
 *   "Quote the response "Rectangle" sent back to you, and say what you wrote to prompt it."
 *
 * Nothing was sent and nothing was written — that is chat vocabulary, inherited from the product the
 * compiler was first built against. A tester reads it as Sage not having understood the product.
 *
 * The STRUCTURE is genuinely shared (act, then something new is on screen); only the words differ.
 * So the words follow the founder's own wording, and nothing else about the compilation changes.
 */

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

const baseJourney = fixture.goalJourney as unknown as GoalJourneyV1;

/** the SAME observed run, with the founder's wording rewritten to a non-conversational product. */
function reworded(map: Record<string, string>): GoalJourneyV1 {
  return {
    ...baseJourney,
    checkpoints: baseJourney.checkpoints.map((c) => ({
      ...c,
      requirement: map[c.kind] ?? c.requirement,
    })),
  };
}

const compile = (journey: GoalJourneyV1) =>
  compileGoalMission({
    journey,
    context,
    steps,
    facts,
    transitions,
    productUrl: "https://yara.garden/",
    totalBudgetBase: BigInt(fixture.totalBudgetBase),
  });

describe("the criterion speaks the product's language", () => {
  it("a conversational goal keeps the concrete chat wording", () => {
    const r = compile(baseJourney);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const all = r.compiled.mission.criteria.join(" ");
    expect(all).toMatch(/NEW response/);
    expect(all).toMatch(/before the message was sent/);
  });

  it("a drawing goal never mentions sending or writing a message", () => {
    const r = compile(
      reworded({
        input: "Draw one rectangle on the canvas",
        outcome: "Confirm the rectangle appears on the canvas",
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.compiled.mission;
    const all = [...m.criteria, ...m.evidenceRequirements].join(" ");
    expect(all).not.toMatch(/message was sent|what you wrote|sent back to you/i);
    expect(all).toMatch(/NEW result/);
    expect(all).toMatch(/not on screen before/i);
  });

  it("the founder's own words decide, not the product name", () => {
    // "submit the form and see the confirmation" — no chat, no drawing
    const r = compile(
      reworded({
        input: "Submit the signup form",
        outcome: "See the confirmation banner",
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const all = r.compiled.mission.criteria.join(" ");
    expect(all).not.toMatch(/message was sent/i);
  });

  it("wording is the ONLY thing that changes — evidence and grounding are identical", () => {
    const chat = compile(baseJourney);
    const draw = compile(
      reworded({
        input: "Draw one rectangle on the canvas",
        outcome: "Confirm the rectangle appears on the canvas",
      }),
    );
    if (!chat.ok || !draw.ok) return;
    const g = (r: typeof chat) =>
      (r.ok ? r.compiled.mission.groundingV1?.criteria ?? [] : []).map((c) => ({
        criterionIndex: c.criterionIndex,
        evidenceIndex: c.evidenceIndex,
        factIds: c.sourceFactIds,
        transitionIds: c.sourceTransitionIds ?? [],
        mode: c.verificationMode,
      }));
    expect(g(draw)).toEqual(g(chat));
    expect(draw.compiled.mission.criteria).toHaveLength(
      chat.compiled.mission.criteria.length,
    );
    expect(draw.compiled.mappings.length).toBe(chat.compiled.mappings.length);
  });
});
