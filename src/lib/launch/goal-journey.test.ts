import { describe, it, expect } from "vitest";
import {
  compileGoalJourney,
  compileJourneyFromRaw,
  evaluateJourney,
  nextUnmetCheckpoint,
  checkJourneyCoverage,
  outcomeCheckpoints,
  journeyTelemetry,
  type GoalJourneyV1,
  type JourneyStep,
  type MissionCoverageView,
} from "./goal-journey";

/**
 * ORDERED FOUNDER-GOAL COMPLETION — a prerequisite (or an early mention of an entity) must never be
 * mistaken for the founder's actual goal. Every case here is product-agnostic: the journeys are compiled
 * from the founder's own words and the evaluator reasons over checkpoint KINDS + real observed evidence.
 */

/* a generic multi-step request: arrive → onboarding → main area → find an entity → open it → send → reply */
const GOAL = "make users land in example.test and go to the guide character and talk to her";
const RAW = {
  checkpoints: [
    { kind: "entry", requirement: "Open the product", targetEntity: "", requiredContext: "", dependsOnIndexes: [], sourcePhrase: "land in example.test" },
    { kind: "state", requirement: "Pass the intro/onboarding", targetEntity: "", requiredContext: "", dependsOnIndexes: [1], sourcePhrase: "land in example.test" },
    { kind: "navigation", requirement: "Reach the main area", targetEntity: "", requiredContext: "main area", dependsOnIndexes: [2], sourcePhrase: "go to the guide character" },
    { kind: "navigation", requirement: "Locate the guide character in the main area", targetEntity: "guide", requiredContext: "main area", dependsOnIndexes: [3], sourcePhrase: "go to the guide character" },
    { kind: "interaction", requirement: "Open the guide conversation", targetEntity: "guide", requiredContext: "", dependsOnIndexes: [4], sourcePhrase: "talk to her" },
    { kind: "input", requirement: "Send a message", targetEntity: "guide", requiredContext: "", dependsOnIndexes: [5], sourcePhrase: "talk to her" },
    { kind: "outcome", requirement: "Observe the response", targetEntity: "guide", requiredContext: "", dependsOnIndexes: [6], sourcePhrase: "talk to her" },
  ],
};
const journey = () => compileJourneyFromRaw(GOAL, RAW, "m", "p") as GoalJourneyV1;

const step = (over: Partial<JourneyStep> & { stateIndex: number }): JourneyStep => ({
  actionKind: "click", actedLabel: "", stateText: "", addedText: "", observableChange: true,
  factIds: [`f${over.stateIndex}`], transitionId: `t${over.stateIndex}`, ...over,
});

const mission = (over: Partial<MissionCoverageView> = {}): MissionCoverageView => ({
  missionKey: "m1", title: "", objective: "", instructions: "", criteria: [], evidenceRequirements: [],
  factIds: ["f1"], transitionIds: [], prerequisites: [], ...over,
});

/* ─────────────────────── compilation (model proposes, Sage disposes) ─────── */

describe("compileJourneyFromRaw — Sage mints identity + order, never the model", () => {
  it("compiles an ordered journey preserving every stated action and the final outcome", () => {
    const j = journey();
    expect(j.checkpoints).toHaveLength(7);
    expect(j.checkpoints.map((c) => c.kind)).toEqual(["entry", "state", "navigation", "navigation", "interaction", "input", "outcome"]);
    expect(outcomeCheckpoints(j).map((c) => c.requirement)).toEqual(["Observe the response"]);
    for (const c of j.checkpoints) expect(c.checkpointId).toMatch(/^cp\d+_[0-9a-f]{8}$/); // Sage-minted
    expect(j.digest).toHaveLength(24);
  });

  it("forces a strictly ORDERED dependency chain (no forward/self deps, no cycles)", () => {
    const j = compileJourneyFromRaw(GOAL, {
      checkpoints: [
        { kind: "outcome", requirement: "Observe the response", targetEntity: "guide", requiredContext: "", dependsOnIndexes: [3], sourcePhrase: "talk to her" },
        { kind: "entry", requirement: "Open the product", targetEntity: "", requiredContext: "", dependsOnIndexes: [9], sourcePhrase: "land in example.test" },
      ],
    })!;
    expect(j.checkpoints[0].dependsOn).toEqual([]); // a forward dep is dropped
    expect(j.checkpoints[1].dependsOn).toEqual([j.checkpoints[0].checkpointId]); // ordered by construction
  });

  it("drops an INVENTED sourcePhrase but keeps verbatim founder text", () => {
    const j = compileJourneyFromRaw(GOAL, {
      checkpoints: [
        { kind: "entry", requirement: "Open it", targetEntity: "", requiredContext: "", dependsOnIndexes: [], sourcePhrase: "buy a subscription" },
        { kind: "outcome", requirement: "Reply", targetEntity: "", requiredContext: "", dependsOnIndexes: [], sourcePhrase: "talk to her" },
      ],
    })!;
    expect(j.checkpoints[0].sourcePhrase).toBe(""); // never in the founder's request → dropped
    expect(j.checkpoints[1].sourcePhrase).toBe("talk to her"); // verbatim → kept
  });

  it("returns null for an empty/unusable decomposition (caller degrades honestly)", () => {
    expect(compileJourneyFromRaw(GOAL, { checkpoints: [] })).toBeNull();
    expect(compileJourneyFromRaw(GOAL, null)).toBeNull();
  });

  it("tolerates a provider that RENAMES the keys (schemas are not reliably enforced)", () => {
    // observed in production: the gateway ignored the strict json_schema and returned its own shape.
    const renamed = {
      project_checkpoints: [
        { type: "entry", task: "Open the product", entity: "", context: "", dependencies: [], source: "land in example.test" },
        { type: "outcome", task: "See the reply", entity: "guide", context: "", dependencies: [1], source: "talk to her" },
      ],
    };
    const j = compileJourneyFromRaw(GOAL, renamed, "m", "p")!;
    expect(j.checkpoints).toHaveLength(2);
    expect(j.checkpoints[0].requirement).toBe("Open the product");
    expect(j.checkpoints[0].kind).toBe("entry");
    expect(j.checkpoints[1].kind).toBe("outcome");
    expect(j.checkpoints[1].targetEntity).toBe("guide");
    expect(j.checkpoints[1].sourcePhrase).toBe("talk to her"); // still verified verbatim
    expect(j.checkpoints[1].dependsOn).toEqual([j.checkpoints[0].checkpointId]); // order still re-derived
  });

  it("refuses an ambiguous reply (several unrelated arrays) rather than guessing", () => {
    expect(compileJourneyFromRaw(GOAL, { a: [{ x: 1 }], b: [{ y: 2 }] })).toBeNull();
  });

  it("compileGoalJourney uses the injected model path and returns a compiled journey", async () => {
    const j = await compileGoalJourney(GOAL, { complete: async () => ({ json: RAW, model: "test-model", provider: "test" }) });
    expect(j?.checkpoints).toHaveLength(7);
    expect(j?.model).toBe("test-model");
  });

  it("compileGoalJourney degrades to null when the model path fails", async () => {
    const j = await compileGoalJourney(GOAL, { complete: async () => { throw new Error("llm_down"); } });
    expect(j).toBeNull();
  });
});

/* ───────────── 1. an entity named during onboarding ≠ finding it later ───── */

describe("#1 an entity mentioned in onboarding does NOT satisfy locating it later", () => {
  it("keeps the locate/open/send/reply checkpoints unmet when the name only appears on the intro screen", () => {
    const j = evaluateJourney(journey(), [
      step({ stateIndex: 0, actionKind: "load", stateText: "Welcome — guide is waiting inside. tap to step inside" }),
      // an onboarding click whose screen MENTIONS the entity by name, but is not the main area
      step({ stateIndex: 1, actionKind: "click", actedLabel: "tap to step inside", stateText: "intro: your guide will meet you soon", addedText: "your guide will meet you soon" }),
    ]);
    const s = Object.fromEntries(j.checkpoints.map((c) => [c.requirement, c.status]));
    expect(s["Open the product"]).toBe("observed");
    expect(s["Pass the intro/onboarding"]).toBe("observed");
    // the entity's NAME appeared, but the main area was never reached → locating it stays unmet
    expect(s["Reach the main area"]).toBe("unmet");
    expect(s["Locate the guide character in the main area"]).toBe("unmet");
    expect(s["Open the guide conversation"]).toBe("unmet");
    expect(s["Observe the response"]).toBe("unmet");
  });

  it("requires the founder's CONTEXT: the same entity click outside the required context does not count", () => {
    const j = evaluateJourney(journey(), [
      step({ stateIndex: 0, actionKind: "load", stateText: "welcome" }),
      step({ stateIndex: 1, actionKind: "click", actedLabel: "start", stateText: "intro", addedText: "intro" }),
      // a click on the entity while still in a settings screen — the required context ("main area") is absent
      step({ stateIndex: 2, actionKind: "click", actedLabel: "guide", stateText: "settings panel", addedText: "settings panel" }),
    ]);
    expect(j.checkpoints[2].status).toBe("unmet"); // "Reach the main area" — wrong context
    expect(j.checkpoints[3].status).toBe("unmet"); // "Locate the guide…" — still unmet
  });
});

/* ─────────────── 2. sequential dependencies cannot complete out of order ─── */

describe("#2 dependencies are structural — no out-of-order completion", () => {
  it("a late-journey observation cannot complete while its prerequisites are unmet", () => {
    const j = evaluateJourney(journey(), [
      // a reply-looking state arrives FIRST — it cannot satisfy the outcome before the earlier steps
      step({ stateIndex: 0, actionKind: "observe_response", stateText: "the guide says hello", addedText: "the guide says hello" }),
    ]);
    expect(j.checkpoints[6].status).toBe("unmet");
    expect(j.checkpoints.filter((c) => c.status === "observed")).toHaveLength(0); // not even entry (it was not a load)
  });

  it("nextUnmetCheckpoint always returns the first dependency-ready checkpoint", () => {
    const j = journey();
    expect(nextUnmetCheckpoint(j)?.requirement).toBe("Open the product");
    const after = evaluateJourney(j, [step({ stateIndex: 0, actionKind: "load", stateText: "welcome" })]);
    expect(nextUnmetCheckpoint(after)?.requirement).toBe("Pass the intro/onboarding");
    expect(nextUnmetCheckpoint(null)).toBeNull();
  });
});

/* ── 3-4. clicking "Meet/Talk" ≠ talking; sending ≠ receiving a response ──── */

describe("#3/#4 opening a conversation is not talking; sending is not receiving", () => {
  const upToOpen = (): JourneyStep[] => [
    step({ stateIndex: 0, actionKind: "load", stateText: "welcome" }),
    step({ stateIndex: 1, actionKind: "click", actedLabel: "enter", stateText: "intro", addedText: "intro" }),
    step({ stateIndex: 2, actionKind: "click", actedLabel: "come in", stateText: "the main area map", addedText: "the main area map" }),
    step({ stateIndex: 3, actionKind: "click", actedLabel: "meet the guide", stateText: "the main area — guide", addedText: "guide" }),
    step({ stateIndex: 4, actionKind: "click", actedLabel: "guide", stateText: "conversation with guide", addedText: "conversation with guide" }),
  ];

  it("#3 clicking 'Meet the guide' + opening the conversation does NOT satisfy sending or receiving", () => {
    const j = evaluateJourney(journey(), upToOpen());
    expect(j.checkpoints[4].status).toBe("observed"); // conversation opened
    expect(j.checkpoints[5].status).toBe("unmet"); // nothing was sent
    expect(j.checkpoints[6].status).toBe("unmet"); // nothing was received
  });

  it("#4 sending a message does NOT satisfy observing a response", () => {
    const j = evaluateJourney(journey(), [...upToOpen(), step({ stateIndex: 5, actionKind: "type", stateText: "conversation", addedText: "" }), step({ stateIndex: 6, actionKind: "submit", stateText: "conversation", addedText: "", observableChange: false })]);
    expect(j.checkpoints[5].status).toBe("observed"); // sent
    expect(j.checkpoints[6].status).toBe("unmet"); // no reply observed → the founder's outcome is NOT met
  });

  it("a real reply (new content after the send) DOES complete the outcome, with cited evidence", () => {
    const j = evaluateJourney(journey(), [
      ...upToOpen(),
      step({ stateIndex: 5, actionKind: "type", stateText: "conversation", addedText: "" }),
      step({ stateIndex: 6, actionKind: "submit", stateText: "conversation", addedText: "", observableChange: false }),
      step({ stateIndex: 7, actionKind: "observe_response", stateText: "conversation", addedText: "warm greetings traveller", factIds: ["fR"], transitionId: "tR" }),
    ]);
    expect(j.checkpoints[6].status).toBe("observed");
    expect(j.checkpoints[6].evidence.factIds).toContain("fR"); // completion CITES real evidence
    expect(j.checkpoints[6].evidence.transitionIds).toContain("tR");
  });
});

/* ───────── 5-6. the coverage gate: partial plans blocked, complete pass ──── */

const fullyObserved = (): GoalJourneyV1 =>
  evaluateJourney(journey(), [
    step({ stateIndex: 0, actionKind: "load", stateText: "welcome" }),
    step({ stateIndex: 1, actionKind: "click", actedLabel: "enter", stateText: "intro", addedText: "intro" }),
    step({ stateIndex: 2, actionKind: "click", actedLabel: "come in", stateText: "the main area map", addedText: "the main area map" }),
    step({ stateIndex: 3, actionKind: "click", actedLabel: "meet the guide", stateText: "the main area — guide", addedText: "guide" }),
    step({ stateIndex: 4, actionKind: "click", actedLabel: "guide", stateText: "conversation with guide", addedText: "conversation with guide" }),
    step({ stateIndex: 5, actionKind: "type", stateText: "conversation", addedText: "" }),
    step({ stateIndex: 6, actionKind: "submit", stateText: "conversation", addedText: "", observableChange: false }),
    step({ stateIndex: 7, actionKind: "observe_response", stateText: "conversation", addedText: "warm greetings traveller" }),
  ]);

describe("#5 a truthful but PARTIAL (prerequisite-only) plan is blocked", () => {
  it("an onboarding-only mission is rejected as prerequisite_only_plan / goal_outcome_uncovered", () => {
    const onboardingOnly = mission({
      title: "Complete the onboarding sequence",
      objective: "Navigate the intro screens",
      instructions: "Open the product and click through the intro until the main area appears.",
      criteria: ["The user reaches the main area"],
      evidenceRequirements: ["Confirm the main area is visible"],
    });
    const r = checkJourneyCoverage(fullyObserved(), [onboardingOnly]);
    expect(r.ok).toBe(false);
    const codes = r.rejections.map((x) => x.code);
    expect(codes).toContain("goal_outcome_uncovered"); // the asked-for reply is not covered
    expect(codes).toContain("goal_checkpoint_uncovered"); // nor is opening/sending
  });

  it("blocks with goal_checkpoint_unobserved when the browser only reached onboarding", () => {
    const partial = evaluateJourney(journey(), [
      step({ stateIndex: 0, actionKind: "load", stateText: "welcome" }),
      step({ stateIndex: 1, actionKind: "click", actedLabel: "enter", stateText: "intro", addedText: "intro" }),
    ]);
    const r = checkJourneyCoverage(partial, [mission({ title: "Complete onboarding", criteria: ["reaches the intro"] })]);
    expect(r.ok).toBe(false);
    expect(r.rejections.map((x) => x.code)).toContain("goal_checkpoint_unobserved");
    expect(r.observedCount).toBeLessThan(r.requiredCount);
  });

  it("a prerequisite may SUPPORT but never SUBSTITUTE for the outcome", () => {
    const withPrereqOnly = mission({
      title: "Reach the main area",
      objective: "Get past onboarding into the main area",
      instructions: "Click through the intro.",
      criteria: ["The user reaches the main area"],
      prerequisites: ["talk to the guide first"], // prerequisite text mentions it — must not count as coverage
    });
    const r = checkJourneyCoverage(fullyObserved(), [withPrereqOnly]);
    expect(r.ok).toBe(false);
    expect(r.rejections.map((x) => x.code)).toContain("goal_outcome_uncovered");
  });
});

describe("#6 a COMPLETE journey mission passes the gate", () => {
  it("passes when every observed checkpoint is covered, including the outcome", () => {
    const complete = mission({
      title: "Reach the guide in the main area and have a conversation",
      objective: "Enter the product, pass the intro, reach the main area, locate the guide, open the conversation, send a message and receive the response",
      instructions: "Open the product, click through the intro until the main area appears, locate the guide character, open the conversation, send a message, and note the response you receive.",
      criteria: [
        "The tester reaches the main area",
        "The tester locates the guide character in the main area",
        "The tester opens the guide conversation",
        "The tester sends a message to the guide",
        "The tester receives a response from the guide",
      ],
      evidenceRequirements: ["Describe the guide's response you received in the conversation"],
    });
    const r = checkJourneyCoverage(fullyObserved(), [complete]);
    expect(r.ok).toBe(true);
    expect(r.rejections).toHaveLength(0);
    expect(r.coveredCount).toBe(r.requiredCount);
  });
});

describe("telemetry is leak-safe", () => {
  it("reports counts + statuses, never observed product text", () => {
    const t = journeyTelemetry(fullyObserved());
    expect(t.journeyPresent).toBe(true);
    if (t.journeyPresent) {
      expect(t.checkpointCount).toBe(7);
      expect(t.checkpointsObserved).toBe(7);
      expect(JSON.stringify(t)).not.toMatch(/warm greetings|main area map/);
    }
    expect(journeyTelemetry(null).journeyPresent).toBe(false);
  });
});

/* ─────────────── 7. unrelated goals still work (general, not one product) ── */

describe("#7 unrelated product journeys behave correctly", () => {
  const DRAW_GOAL = "let users open the whiteboard and draw a rectangle on the canvas";
  const drawJourney = () =>
    compileJourneyFromRaw(DRAW_GOAL, {
      checkpoints: [
        { kind: "entry", requirement: "Open the whiteboard", targetEntity: "whiteboard", requiredContext: "", dependsOnIndexes: [], sourcePhrase: "open the whiteboard" },
        { kind: "interaction", requirement: "Select the rectangle tool", targetEntity: "rectangle", requiredContext: "", dependsOnIndexes: [1], sourcePhrase: "draw a rectangle" },
        { kind: "outcome", requirement: "A rectangle appears on the canvas", targetEntity: "rectangle", requiredContext: "canvas", dependsOnIndexes: [2], sourcePhrase: "draw a rectangle on the canvas" },
      ],
    })!;

  it("a canvas/drawing journey completes from real drag evidence (no conversation involved)", () => {
    const j = evaluateJourney(drawJourney(), [
      step({ stateIndex: 0, actionKind: "load", stateText: "whiteboard canvas" }),
      step({ stateIndex: 1, actionKind: "click", actedLabel: "rectangle", stateText: "whiteboard canvas", addedText: "rectangle selected" }),
      step({ stateIndex: 2, actionKind: "drag", stateText: "whiteboard canvas — shape", addedText: "stroke fill opacity" }),
    ]);
    expect(j.checkpoints.map((c) => c.status)).toEqual(["observed", "observed", "observed"]);
  });

  it("a DOM signup journey (no entity, no conversation) is unaffected", () => {
    const g = "let users complete the signup and reach the welcome screen";
    const j = compileJourneyFromRaw(g, {
      checkpoints: [
        { kind: "entry", requirement: "Open the site", targetEntity: "", requiredContext: "", dependsOnIndexes: [], sourcePhrase: "complete the signup" },
        { kind: "input", requirement: "Fill the signup form", targetEntity: "", requiredContext: "", dependsOnIndexes: [1], sourcePhrase: "complete the signup" },
        { kind: "outcome", requirement: "The welcome screen appears", targetEntity: "welcome", requiredContext: "", dependsOnIndexes: [2], sourcePhrase: "reach the welcome screen" },
      ],
    })!;
    const done = evaluateJourney(j, [
      step({ stateIndex: 0, actionKind: "load", stateText: "sign up" }),
      step({ stateIndex: 1, actionKind: "type", stateText: "sign up", addedText: "" }),
      step({ stateIndex: 2, actionKind: "click", actedLabel: "continue", stateText: "welcome aboard", addedText: "welcome aboard" }),
    ]);
    expect(done.checkpoints.every((c) => c.status === "observed")).toBe(true);
    const r = checkJourneyCoverage(done, [
      mission({
        title: "Complete signup and reach the welcome screen",
        instructions: "Open the site, fill in the signup form, submit it, and confirm the welcome screen appears.",
        criteria: ["The tester completes the signup form", "The tester reaches the welcome screen"],
        evidenceRequirements: ["Confirm the welcome screen"],
      }),
    ]);
    expect(r.ok).toBe(true);
  });
});
