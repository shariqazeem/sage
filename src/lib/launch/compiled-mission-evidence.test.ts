import { describe, it, expect } from "vitest";
import { compileGoalMission } from "./goal-mission-compiler";
import {
  buildJourneySteps,
  bindJourneyToContext,
  evaluateJourney,
  type GoalJourneyV1,
  type JourneyStep,
} from "./goal-journey";
import {
  distillPrivateKey,
  verifyAgainstKey,
} from "@/lib/deputy/observation-verify";
import { classifyVerifiability } from "./validate-mission";
import type { ProductContextV1 } from "./product-context";
import type { ObservedFactV1, ActionTransitionV1 } from "./observed-facts";
import type { FieldTestSummary } from "./schemas";
import fixture from "./__fixtures__/yara-clarified-run.json";

/**
 * EVIDENCE-CHECKING for a COMPILER-authored mission. The payout side pins a private answer key distilled
 * from Sage's own field test MINUS every public plan string, so a tester who parrots the card scores
 * structural zero. A compiled mission embeds observed labels in its criteria/evidence, so this asserts the
 * key survives (a genuine tester can still be matched) while the parrot defence still holds.
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
  (fixture.states as unknown[]).map(
    (_, i) => context.entities.find((x) => x.stateIndex === i)?.stateId ?? "",
  ),
).map((s, i) => ({ ...s, phase: context.statePhases[i] }));

const fieldTest = {
  ran: true,
  startUrl: "https://yara.garden/",
  mode: "interactive",
  pages: [],
  states: fixture.states,
  classification: null,
  limitation: null,
  durationMs: 1000,
} as unknown as FieldTestSummary;

function compiled() {
  const j = evaluateJourney(
    bindJourneyToContext(journey, context).journey,
    steps,
  );
  const r = compileGoalMission({
    journey: j,
    context,
    steps,
    facts,
    transitions,
    productUrl: "https://yara.garden/",
    totalBudgetBase: BigInt(1_500_000),
  });
  if (!r.ok) throw new Error(r.reason);
  return r.compiled.mission;
}

const publicStringsOf = (m: ReturnType<typeof compiled>) => [
  m.title,
  m.objective,
  m.instructions,
  m.targetSurface,
  ...m.criteria,
  ...m.evidenceRequirements,
  m.whyItMatters,
];

describe("a compiled mission still leaves a usable private answer key", () => {
  it("the key survives the mission's public text (evidence judging is not starved)", () => {
    const m = compiled();
    const key = distillPrivateKey(fieldTest, publicStringsOf(m));
    // Sage keeps a real corpus of firsthand observations the card never reveals
    expect(key.observations.length).toBeGreaterThan(10);
    expect(key.distinctSources).toBeGreaterThan(0);
    expect(key.digest).toBeTruthy();
  });

  it("a PARROT of the mission card scores structurally zero (anti-guess holds)", () => {
    const m = compiled();
    const key = distillPrivateKey(fieldTest, publicStringsOf(m));
    const parrot = publicStringsOf(m).join(" ");
    const match = verifyAgainstKey(parrot, key);
    expect(match.matchedCount).toBe(0);
    expect(match.distinctSources).toBe(0);
  });

  it("a genuine firsthand account MATCHES the private key", () => {
    const m = compiled();
    const key = distillPrivateKey(fieldTest, publicStringsOf(m));
    // phrases only someone who actually walked the product would write (drawn from real observed states)
    const account = (fixture.states as { visibleTextExcerpt?: string }[])
      .map((s) => s.visibleTextExcerpt ?? "")
      .join(" ")
      .slice(0, 1200);
    const match = verifyAgainstKey(account, key);
    expect(match.matchedCount).toBeGreaterThan(0);
    expect(match.distinctSources).toBeGreaterThan(0);
  });

  it("the mission is classified observation-based (manual/lived), never url-verifiable", () => {
    const m = compiled();
    expect(
      classifyVerifiability({
        objective: m.objective,
        criteria: m.criteria,
        evidenceRequirements: m.evidenceRequirements,
      }),
    ).toBe("observation-based");
  });
});
