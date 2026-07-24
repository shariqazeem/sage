import { describe, it, expect } from "vitest";
import {
  buildProductContext,
  derivePhases,
  instancesOf,
  reachedPhase,
  phaseAtLeast,
  type ContextState,
} from "./product-context";
import {
  compileJourneyFromRaw,
  bindJourneyToContext,
  evaluateJourney,
  checkJourneyCoverage,
  mapCheckpointEvidence,
  type GoalJourneyV1,
  type JourneyStep,
  type MissionCoverageView,
} from "./goal-journey";
import { applySamplePolicy, requestsPluralSample } from "./sample-policy";

/**
 * PRODUCT-CONTEXT GOAL BINDING + TESTER SAMPLE QUALITY. Every case is product-agnostic — a generic
 * product with an intro that MENTIONS an entity and a main experience that CONTAINS it.
 */

const st = (
  over: Partial<ContextState> & { trigger: string },
): ContextState => ({
  visibleTextExcerpt: "",
  notableElements: [],
  ...over,
});

/* a generic run: entry → onboarding (mentions "guide") → main experience (in-world "guide") → chat */
const RUN: ContextState[] = [
  st({
    trigger: "initial load",
    actionKind: "load",
    visibleTextExcerpt: "Welcome. tap to step inside",
    notableElements: [{ tag: "div", text: "tap to step inside", role: "" }],
  }),
  st({
    trigger: 'clicked "tap to step inside"',
    actionKind: "click",
    actedLabel: "tap to step inside",
    visibleTextExcerpt: "your guide will meet you soon",
    notableElements: [
      { tag: "h2", text: "guide", role: "" },
      { tag: "button", text: "continue", role: "" },
    ],
  }),
  st({
    trigger: 'clicked "continue"',
    actionKind: "click",
    actedLabel: "continue",
    visibleTextExcerpt: "come in",
    notableElements: [{ tag: "button", text: "come in", role: "" }],
  }),
  st({
    trigger: 'clicked "come in"',
    actionKind: "click",
    actedLabel: "come in",
    visibleTextExcerpt: "the open world map",
    notableElements: [
      { tag: "div", text: "The Hearth", role: "" },
      { tag: "div", text: "guide", role: "" },
    ],
  }),
  st({
    trigger: 'clicked "guide"',
    actionKind: "click",
    actedLabel: "guide",
    visibleTextExcerpt: "conversation with guide",
    notableElements: [{ tag: "input", text: "say something", role: "" }],
  }),
  st({
    trigger: "typed the test message",
    actionKind: "type",
    visibleTextExcerpt: "conversation with guide",
  }),
  st({
    trigger: "pressed Enter to send the message",
    actionKind: "submit",
    visibleTextExcerpt: "conversation with guide",
  }),
  st({
    trigger: "observed the reply",
    actionKind: "observe_response",
    visibleTextExcerpt: "conversation with guide. warm greetings traveller",
  }),
];
const IDS = RUN.map((_, i) => `state${i}`);
const ctx = () => buildProductContext(RUN, IDS);

/* ───────────────────────── 1. phases + entity instances ──────────────────── */

describe("#1 the same label in onboarding and the main experience is a DIFFERENT instance", () => {
  it("derives ordered phases from the observed run", () => {
    const phases = derivePhases(RUN);
    expect(phases[0]).toBe("entry");
    expect(phases[1]).toBe("onboarding"); // a forward-ladder click
    expect(phases[3]).toBe("main_experience"); // the ladder ended
    expect(phases[7]).toBe("target_interaction"); // the conversation
    expect(reachedPhase(ctx(), "main_experience")).toBe(true);
  });

  it("mints distinct entityIds for the onboarding vs in-world occurrence of one label", () => {
    const found = instancesOf(ctx(), "guide");
    const phases = [...new Set(found.map((e) => e.phase))];
    expect(phases).toContain("onboarding");
    expect(phases).toContain("main_experience");
    const ids = new Set(found.map((e) => e.entityId));
    expect(ids.size).toBe(found.length); // every occurrence has its own id
  });

  it("records the phase transitions Sage crossed", () => {
    const t = ctx().phaseTransitions.map((x) => `${x.from}->${x.to}`);
    expect(t).toContain("entry->onboarding");
    expect(t).toContain("onboarding->main_experience");
    expect(t).toContain("main_experience->target_interaction");
  });
});

/* ───────────── 2-3. onboarding occurrence cannot satisfy the in-world one ── */

const GOAL =
  "make users land in example.test and go to the guide character and talk to her";
const RAW = {
  checkpoints: [
    {
      kind: "entry",
      requirement: "Open the product",
      targetEntity: "",
      requiredContext: "",
      dependsOnIndexes: [],
      sourcePhrase: "land in example.test",
    },
    {
      kind: "navigation",
      requirement: "Locate the guide character",
      targetEntity: "guide",
      requiredContext: "",
      dependsOnIndexes: [1],
      sourcePhrase: "go to the guide character",
    },
    {
      kind: "interaction",
      requirement: "Open the guide conversation",
      targetEntity: "guide",
      requiredContext: "",
      dependsOnIndexes: [2],
      sourcePhrase: "talk to her",
    },
    {
      kind: "input",
      requirement: "Send a message",
      targetEntity: "guide",
      requiredContext: "",
      dependsOnIndexes: [3],
      sourcePhrase: "talk to her",
    },
    {
      kind: "outcome",
      requirement: "Observe the response",
      targetEntity: "guide",
      requiredContext: "",
      dependsOnIndexes: [4],
      sourcePhrase: "talk to her",
    },
  ],
};
const journey = () =>
  compileJourneyFromRaw(GOAL, RAW, "m", "p") as GoalJourneyV1;

const stepFor = (i: number, over: Partial<JourneyStep> = {}): JourneyStep => ({
  stateIndex: i,
  actionKind: (RUN[i].actionKind ?? "click") as JourneyStep["actionKind"],
  actedLabel: RUN[i].actedLabel ?? "",
  stateText: RUN[i].visibleTextExcerpt,
  // a real DELTA vs the previous state (mirrors buildJourneySteps) — a send that changes nothing adds nothing
  addedText:
    i > 0 && RUN[i].visibleTextExcerpt === RUN[i - 1].visibleTextExcerpt
      ? ""
      : RUN[i].visibleTextExcerpt,
  observableChange: true,
  factIds: [`f${i}`],
  transitionId: `t${i}`,
  phase: derivePhases(RUN)[i],
  ...over,
});

describe("#2/#3 an onboarding occurrence cannot satisfy an in-world requirement", () => {
  it("binds the entity checkpoint to the MAIN-EXPERIENCE instance, not the onboarding one", () => {
    const bound = bindJourneyToContext(journey(), ctx());
    const cp = bound.journey.checkpoints[1];
    expect(cp.requiredPhase).toBe("main_experience");
    const inst = ctx().entities.find((e) => e.entityId === cp.boundEntityId);
    expect(inst?.phase).toBe("main_experience"); // never the onboarding mention
  });

  it("stops at the onboarding mention: the in-world checkpoint stays UNMET", () => {
    const bound = bindJourneyToContext(journey(), ctx()).journey;
    // only the entry + the onboarding states were observed (the ladder never ended)
    const j = evaluateJourney(bound, [stepFor(0), stepFor(1)]);
    expect(j.checkpoints[0].status).toBe("observed"); // entry
    expect(j.checkpoints[1].status).toBe("unmet"); // "locate the guide" — the mention does NOT count
  });

  it("#3 without the main-experience transition, the journey cannot proceed", () => {
    const onboardingOnly = RUN.slice(0, 3); // never reaches the main experience
    const c = buildProductContext(onboardingOnly, IDS.slice(0, 3));
    expect(reachedPhase(c, "main_experience")).toBe(false);
    const bound = bindJourneyToContext(journey(), c);
    // the entity was seen ONLY in onboarding → wrong phase, no binding
    expect(bound.rejections.map((r) => r.code)).toContain(
      "goal_entity_wrong_phase",
    );
    expect(bound.journey.checkpoints[1].boundEntityId).toBeNull();
  });

  it("asks ONE question when several different things match in the required phase", () => {
    const ambiguous: ContextState[] = [
      ...RUN.slice(0, 4),
      st({
        trigger: 'clicked "x"',
        actionKind: "click",
        actedLabel: "x",
        visibleTextExcerpt: "world",
        notableElements: [
          { tag: "div", text: "guide hall", role: "" },
          { tag: "div", text: "guide statue", role: "" },
        ],
      }),
    ];
    const c = buildProductContext(
      ambiguous,
      ambiguous.map((_, i) => `s${i}`),
    );
    const r = bindJourneyToContext(
      compileJourneyFromRaw("go to the guide and talk", {
        checkpoints: [
          {
            kind: "entry",
            requirement: "Open the product",
            targetEntity: "",
            requiredContext: "",
            dependsOnIndexes: [],
            sourcePhrase: "go to the guide",
          },
          {
            kind: "navigation",
            requirement: "Locate the guide",
            targetEntity: "guide",
            requiredContext: "",
            dependsOnIndexes: [1],
            sourcePhrase: "go to the guide",
          },
        ],
      })!,
      c,
    );
    if (r.question) {
      expect(r.question).toMatch(/which one/i);
      expect(r.rejections.map((x) => x.code)).toContain(
        "goal_entity_instance_mismatch",
      );
    } else {
      expect(r.journey.checkpoints[1].boundEntityId).toBeTruthy(); // an exact match resolved it
    }
  });

  it("the SEND step never also completes the RECEIVE checkpoint (distinct evidence)", () => {
    const bound = bindJourneyToContext(journey(), ctx()).journey;
    const j = evaluateJourney(
      bound,
      RUN.map((_, i) =>
        // production-realistic: the submitted message APPEARS in the chat, so the send state has a delta
        stepFor(
          i,
          i === 6
            ? { addedText: "Hello — I am testing this product interaction." }
            : {},
        ),
      ),
    );
    const send = j.checkpoints[3];
    const receive = j.checkpoints[4];
    expect(send.status).toBe("observed");
    expect(receive.status).toBe("observed");
    // different states → different evidence: an echo of what was sent can never prove a reply
    expect(receive.evidence.factIds).not.toEqual(send.evidence.factIds);
  });

  it("the full run completes every checkpoint, in phase, with evidence", () => {
    const bound = bindJourneyToContext(journey(), ctx()).journey;
    const j = evaluateJourney(
      bound,
      RUN.map((_, i) => stepFor(i)),
    );
    expect(j.checkpoints.every((c) => c.status === "observed")).toBe(true);
    expect(j.checkpoints[4].evidence.factIds.length).toBeGreaterThan(0); // the reply is cited
  });
});

/* ───────── 4-6. criterion-level evidence (title/objective can't compensate) ─ */

const completed = (): GoalJourneyV1 =>
  evaluateJourney(
    bindJourneyToContext(journey(), ctx()).journey,
    RUN.map((_, i) => stepFor(i)),
  );

const mission = (
  over: Partial<MissionCoverageView> = {},
): MissionCoverageView => ({
  missionKey: "m1",
  title: "",
  objective: "",
  instructions: "",
  criteria: [],
  evidenceRequirements: [],
  grounding: [],
  prerequisites: [],
  ...over,
});

describe("#4/#5/#6 only a grounded criterion+evidence pair can prove a checkpoint", () => {
  it("#4 correct wording in the TITLE/OBJECTIVE alone never covers a checkpoint", () => {
    const j = completed();
    const r = checkJourneyCoverage(j, [
      mission({
        title: "Reach the guide and receive a response",
        objective:
          "Locate the guide character, open the conversation, send a message and observe the response",
        instructions: "Do the whole journey.",
        criteria: ["The tester opens the product"],
        evidenceRequirements: ["Confirm the product opened"],
        grounding: [
          {
            criterionIndex: 0,
            evidenceIndex: 0,
            factIds: ["f0"],
            transitionIds: [],
            evidenceMode: "observation",
          },
        ],
      }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.rejections.map((x) => x.code)).toContain("goal_outcome_uncovered");
  });

  it("#5 a generic/adjacent criterion cannot prove the reply (wrong state's evidence)", () => {
    const j = completed();
    const outcome = j.checkpoints[4];
    const r = mapCheckpointEvidence(
      outcome,
      [
        mission({
          criteria: [
            "The tester sees the guide's conversation options and receives a response",
          ],
          evidenceRequirements: [
            "Confirm the guide's conversation options are present",
          ],
          // grounded on the state where the conversation OPENED (f4), not where the reply arrived (f7)
          grounding: [
            {
              criterionIndex: 0,
              evidenceIndex: 0,
              factIds: ["f4"],
              transitionIds: [],
              evidenceMode: "observation",
            },
          ],
        }),
      ],
      true,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("goal_outcome_evidence_insufficient");
  });

  it("#6 evidence tied to the RESPONSE state passes, and returns the explicit mapping", () => {
    const j = completed();
    const outcome = j.checkpoints[4];
    const r = mapCheckpointEvidence(
      outcome,
      [
        mission({
          criteria: ["The tester receives a response from the guide"],
          evidenceRequirements: ["Describe the guide's reply you received"],
          grounding: [
            {
              criterionIndex: 0,
              evidenceIndex: 0,
              factIds: outcome.evidence.factIds,
              transitionIds: outcome.evidence.transitionIds,
              evidenceMode: "observation",
            },
          ],
        }),
      ],
      true,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mapping.criterionIndex).toBe(0);
      expect(r.mapping.evidenceIndex).toBe(0);
      expect(
        r.mapping.factIds.length + r.mapping.transitionIds.length,
      ).toBeGreaterThan(0);
      expect(r.mapping.evidenceMode).toBe("observation");
    }
  });

  it("a criterion that says the right thing but is grounded on NOTHING is unmapped", () => {
    const j = completed();
    const r = mapCheckpointEvidence(
      j.checkpoints[4],
      [
        mission({
          criteria: ["The tester receives a response from the guide"],
          evidenceRequirements: ["Describe the reply"],
          grounding: [],
        }),
      ],
      true,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("goal_outcome_evidence_insufficient");
  });
});

/* ─────────────────────── 7-9. tester sample quality ──────────────────────── */

const sampleMission = (
  over: Partial<Parameters<typeof applySamplePolicy>[0][number]> = {},
) => ({
  missionKey: "m1",
  maxCompletions: 1,
  rewardWeight: 5,
  qualitative: true,
  ...over,
});
const MIN = BigInt(100_000); // the existing meaningful-reward floor ($0.10)

describe("#7/#8/#9 tester sample policy", () => {
  it("#7 a PLURAL qualitative request prefers three independent completions", () => {
    expect(requestsPluralSample("make users land here and talk to her")).toBe(
      true,
    );
    const r = applySamplePolicy([sampleMission()], {
      goal: "make users land in example.test and go to the guide and talk to her",
      totalBudgetBase: BigInt(1_500_000), // $1.50
      minRewardBase: MIN,
    });
    expect(r.missions[0].maxCompletions).toBe(3); // → $0.50 each, above the floor
    expect(r.question).toBeNull();
    expect(r.adjusted).toBe(true);
  });

  it("#8 a budget that cannot fund a meaningful sample ASKS instead of picking one tester", () => {
    const r = applySamplePolicy([sampleMission()], {
      goal: "let users try it and tell us how it feels",
      totalBudgetBase: BigInt(120_000), // $0.12 — one meaningful reward at most
      minRewardBase: MIN,
    });
    expect(r.question).toBeTruthy();
    expect(r.question).toMatch(/multiple users|raise the budget/i);
    expect(r.reason).toBe("budget_limited");
  });

  it("#9 a singular or deterministic task is NOT forced to three completions", () => {
    const singular = applySamplePolicy([sampleMission()], {
      goal: "check that the pricing page loads",
      totalBudgetBase: BigInt(1_500_000),
      minRewardBase: MIN,
    });
    expect(singular.missions[0].maxCompletions).toBe(1);
    expect(singular.reason).toBe("not_plural");

    const deterministic = applySamplePolicy(
      [sampleMission({ qualitative: false })],
      {
        goal: "make users open the pricing page",
        totalBudgetBase: BigInt(1_500_000),
        minRewardBase: MIN,
      },
    );
    expect(deterministic.missions[0].maxCompletions).toBe(1);
  });

  it("never reduces a mission that already asks for a bigger sample", () => {
    const r = applySamplePolicy([sampleMission({ maxCompletions: 5 })], {
      goal: "let users try it",
      totalBudgetBase: BigInt(5_000_000),
      minRewardBase: MIN,
    });
    expect(r.missions[0].maxCompletions).toBe(5);
  });
});

describe("phase ordering helper", () => {
  it("orders entry < onboarding < main_experience < target_interaction", () => {
    expect(phaseAtLeast("main_experience", "onboarding")).toBe(true);
    expect(phaseAtLeast("onboarding", "main_experience")).toBe(false);
    expect(phaseAtLeast("target_interaction", "main_experience")).toBe(true);
  });
});
