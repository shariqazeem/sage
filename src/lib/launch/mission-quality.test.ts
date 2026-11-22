import { describe, expect, it } from "vitest";
import { answerIsOnTheCard, asksOwnDetail, isPlaceholderTarget, missionQualityIssues, namesNoTarget, needsDeveloperTools } from "./mission-quality";
import { validateMission, type ValidationScope } from "./validate-mission";
import type { CandidateMission, MissionValidationCode } from "./schemas";

/**
 * FOUR THINGS A CAREFUL TESTER WOULD STOP AT, as invented fixtures.
 *
 * The rules were found by reading every stored plan with today's gate (`tests/plans-corpus/measure.live.test.ts`,
 * which needs the private export). Nothing from that export is here: every product, sentence and label below is
 * made up, shaped like what was read. Each rule has the shapes it must catch and, beside them, the near misses
 * that were measured as good missions and must keep passing.
 */

const SCOPE: ValidationScope = { hosts: new Set(["paperboat.example"]), knownUrls: new Set(["https://paperboat.example/", "https://paperboat.example/fold"]), repoPaths: new Set() };

function mission(over: Partial<CandidateMission> = {}): CandidateMission {
  return {
    missionKey: "fold-a-first-boat",
    title: "Fold a first boat and say where you stopped",
    objective: "Find out whether a newcomer can fold a paper boat with the guide and where they get stuck.",
    instructions: "1. Open https://paperboat.example/fold.\n2. Press Begin folding and follow the steps.\n3. Note the step you finished or stopped on.",
    targetSurface: "https://paperboat.example/fold",
    criteria: ["The answer names the folding step the tester finished or stopped on.", "The answer says what the guide showed after the last fold."],
    evidenceRequirements: ["Which step did you finish or stop on, in the guide's own words?", "What did the guide show after your last fold?"],
    whyItMatters: "The guide is the product: a builder needs to know which fold loses people.",
    sources: [{ kind: "page", ref: "https://paperboat.example/fold", observation: "the folding guide" }],
    priority: "high",
    riskCategory: "critical_journey",
    effortMinutes: 6,
    conditions: ["A sheet of paper"],
    rewardWeight: 6,
    maxCompletions: 5,
    verificationMethod: "Sage checks the named step and the closing screen against what it saw in the guide.",
    confidence: 0.8,
    assumptions: [],
    disallowed: [],
    anchors: ["Begin folding"],
    ...over,
  };
}

const codes = (m: CandidateMission): MissionValidationCode[] => validateMission(m, SCOPE).issues.map((i) => i.code);

describe("the mission the rules are measured against is a good one", () => {
  it("passes the gate and none of the four", () => {
    expect(missionQualityIssues(mission())).toEqual([]);
    expect(validateMission(mission(), SCOPE).ok).toBe(true);
  });
});

describe("1. a place with no name", () => {
  it.each([
    'Open the product as a first-time user — reaching "the target" in the product\'s main experience',
    'Pass any intro shown to a new user and reach the core experience — reaching "core experience" in the product\'s main experience',
    "Describe how you reached “the core experience” and what you saw when it opened.",
    'Say exactly what you did to "main flow", and describe what appeared as a result.',
  ])("catches: %s", (line) => {
    expect(namesNoTarget({ criteria: [line], evidenceRequirements: [] })).not.toBeNull();
    expect(codes(mission({ criteria: [line, "The answer says what happened next."] }))).toContain("unnamed_target");
  });

  it.each([
    'Reach the folding guide — reaching "Begin folding" in the product\'s main experience',
    'Describe how you reached "the main screen of paperboat.example" and what you saw when it opened.',
    "The answer says whether the core experience of folding made sense to a newcomer.",
    'Quote the heading under "Main features" on the home page.',
  ])("keeps: %s", (line) => {
    expect(namesNoTarget({ criteria: [line], evidenceRequirements: [line] })).toBeNull();
  });

  it("knows a placeholder label from a real one", () => {
    for (const p of ["the target", "core experience", "The Core Experience", "main flow", "primary feature"]) expect(isPlaceholderTarget(p)).toBe(true);
    for (const real of ["Begin folding", "the wishing tree", "core", "pricing", "", null]) expect(isPlaceholderTarget(real)).toBe(false);
  });
});

describe("2. the tester's own details", () => {
  it.each([
    "Which email address did you use to join the folding club, and did the code come?",
    "Which email and password did you type on the sign-in page?",
    "Which phone number did you enter on the sign-in screen?",
    "What email did you submit in the newsletter box?",
  ])("catches: %s", (line) => {
    expect(asksOwnDetail({ evidenceRequirements: [line] })).not.toBeNull();
    expect(codes(mission({ evidenceRequirements: [line, "What did the next screen show?"] }))).toContain("asks_personal_detail");
  });

  it.each([
    "Which labels sit above the box for your phone number?",
    "What does the help page promise after your email is verified?",
    "Did a code reach your email within a minute?",
    "What error appeared when you left the email field empty?",
  ])("keeps: %s", (line) => {
    expect(asksOwnDetail({ evidenceRequirements: [line] })).toBeNull();
  });
});

describe("3. developer tools in what the mission is paid for", () => {
  it.each([
    "The answer gives the total bytes the Network tab of DevTools shows after a reload.",
    "How large is the transfer size of the guide, in KB?",
    "The answer counts the lines in the page source of the guide.",
    "Report the number of network requests made on a fresh load.",
    "Say what the browser dev tools console printed while you folded.",
    "What do the developer tools show for the fold button?",
  ])("catches: %s", (line) => {
    expect(needsDeveloperTools({ criteria: [line], evidenceRequirements: [] })).not.toBeNull();
    expect(codes(mission({ criteria: [line, "The answer names the step reached."] }))).toContain("needs_developer_tools");
  });

  it.each([
    // a passing clause beside a real task: 34 stored missions read this way and were good work
    "The boat appears in the gallery with no console errors or broken layout.",
    "Did anything go wrong while folding (nothing appeared, a blank panel, a console error)?",
    // the tools as one way among others
    "The tester narrows the window (or uses DevTools device emulation) to phone width and says how the guide wraps.",
    "Either open the page on a phone, or use DevTools mobile emulation, and say whether the text wraps.",
    // a product's own category list
    "Quote the shelf buttons visible (All, Paper, Glue/Dev Tools, Scissors).",
  ])("keeps: %s", (line) => {
    expect(needsDeveloperTools({ criteria: [line], evidenceRequirements: [line] })).toBeNull();
  });

  it("reads only what is paid for: a step that mentions the tools is not a refusal", () => {
    const m = mission({ instructions: "1. Open https://paperboat.example/fold (a phone, or DevTools device emulation, both work).\n2. Press Begin folding.\n3. Note where you stopped." });
    expect(validateMission(m, SCOPE).ok).toBe(true);
  });
});

describe("4. the answer is on the card", () => {
  it.each([
    [["Provide the URL https://paperboat.example/fold", "Quote the text 'Well folded!'"]],
    [["Provide the URL of the page (https://paperboat.example/).", "Quote the text 'Step 3 of 7' observed after the second fold."]],
    [["Quote the text 'Begin folding' as it appears on the button."]],
  ])("catches: %j", (asks) => {
    expect(answerIsOnTheCard({ evidenceRequirements: asks })).toBe(true);
    expect(codes(mission({ evidenceRequirements: asks }))).toContain("answer_on_the_card");
  });

  it.each([
    // one open question is enough: the card no longer answers itself
    [["Provide the URL https://paperboat.example/fold", "What did the guide show after your last fold?"]],
    [["Provide the exact text block following 'All of Starter, and:' on the plans page."]],
    [["Quote the first line the guide showed after you pressed 'Begin folding'."]],
    [["Provide the URL of the guide you reached.", "Quote its first heading."]],
  ])("keeps: %j", (asks) => {
    expect(answerIsOnTheCard({ evidenceRequirements: asks })).toBe(false);
  });
});

describe("the rules read the mission's own words and nothing else", () => {
  it("a refusal carries a plain reason the corrective round can act on", () => {
    const issues = missionQualityIssues(mission({ criteria: ['Open the product — reaching "the target" in the product\'s main experience'], evidenceRequirements: ["What email address did you use to sign up?"] }));
    expect(issues.map((i) => i.code)).toEqual(["unnamed_target", "asks_personal_detail"]);
    for (const i of issues) expect(i.detail).toMatch(/\p{L}{4,}/u);
  });
});
