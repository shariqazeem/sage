// @vitest-environment node
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BEHAVIOURS, onFakeClock, Zoo, type Behaviour, type ZooCall } from "./zoo";
import { CORE_MISSION_KEY } from "@/lib/core-test/shape";
import { verifySubmission } from "@/lib/deputy/brain";
import type { BrainInput } from "@/lib/deputy/brain-core";
import { identityOf, judgeIdentityGate } from "@/lib/deputy/model-policy";
import { judgeObservationAccount } from "@/lib/deputy/observation-judge";
import { plainLookFor, wordFirstLook } from "@/lib/first-look";
import { askCorePlace } from "@/lib/launch/core-decision";
import { draftDirectCampaign } from "@/lib/launch/gig-draft";
import { missionDesignBudgetMs, runMissionBrain } from "@/lib/launch/mission-brain";
import { ARCHITECT_SYSTEM, CRITIC_SYSTEM } from "@/lib/launch/mission-prompt";
import { CORE_DECISION_SYSTEM } from "@/lib/launch/core-decision";
import { scopeFromObservations } from "@/lib/launch/product-map";
import type { CandidateMission, FieldTestSummary, ProductMapV1 } from "@/lib/launch/schemas";
import { buildObservationCorpus, validatePlanMissions } from "@/lib/launch/validate-mission";
import { resolveVisionProvider } from "@/lib/launch/vision";
import { llmCompleteJson } from "@/lib/llm/complete";
import { resetModelHealth } from "@/lib/llm/model-health";
import { completeSteadily } from "@/lib/llm/steady";
import { resetWireMemory } from "@/lib/llm/wire";

/**
 * THE CORE NEVER STALLS, ON ANY MODEL (22 Nov 2026).
 *
 * Each lane of Sage's core is run against each behaviour family a real provider has shown (zoo.ts), with a
 * healthy fallback provider beside it, on the fake clock. Every row must:
 *  1. return a VALID result, or the lane's documented plain version (never throw, never invent);
 *  2. finish inside the lane's wall-clock budget;
 *  3. make a bounded number of provider calls;
 *  4. keep the money rules: no amount from a model, quotes verbatim, a heuristic never pays, and a judgment
 *     from an identity that is not the pinned one never pays.
 *
 * Measured before these rules existed (21 Nov 2026, staging P-GEN): mission design on a model that thinks its
 * whole budget away held "generating_missions" for 1,500 s, and a model answering 500 to every call cost every
 * job its full retry ladder.
 */
const MISSION_HOST = "mission.zoo.test";
const SHARED_HOST = "shared.zoo.test";
const FALLBACK_HOST = "fallback.zoo.test";
const OBS_HOST = "obs.zoo.test";
const PAYOUT_HOST = "payout.zoo.test";
const FAST = "openai/gpt-5.4-mini-2026-03-17";
const REASONING = "minimax/minimax-m3";

const ENV: Record<string, string> = {
  LLM_API_KEY: "k-shared", LLM_BASE_URL: `https://${SHARED_HOST}/v1`, LLM_MODEL: FAST,
  LLM_FALLBACK_API_KEY: "k-fallback", LLM_FALLBACK_BASE_URL: `https://${FALLBACK_HOST}/v1`, LLM_FALLBACK_MODEL: FAST,
  MISSION_API_KEY: "k-mission", MISSION_BASE_URL: `https://${MISSION_HOST}/v1`, MISSION_MODEL: REASONING,
  OBS_JUDGE_API_KEY: "k-obs", OBS_JUDGE_BASE_URL: `https://${OBS_HOST}/v1`, OBS_JUDGE_MODEL: REASONING,
};
const CLEARED = ["COMMONSTACK_API_KEY", "COMMONSTACK_BASE_URL", "DEPUTY_MODEL", "LLM_TIMEOUT_MS", "LLM_DAILY_BUDGET_USD", "LLM_RETRY_MAX_WAIT_MS", "MISSION_GROUNDING_MODE", "MISSION_DESIGN_BUDGET_MS", "MISSION_HEDGE_AFTER_MS", "DRAFT_HEDGE_AFTER_MS", "LLM_OVERTHINK_COOLING_MS",
  "DRAFT_API_KEY", "DRAFT_BASE_URL", "DRAFT_MODEL", "REPORT_API_KEY", "REPORT_BASE_URL", "REPORT_MODEL", "VISION_API_KEY", "VISION_BASE_URL", "VISION_MODEL", "PAYOUT_API_KEY", "PAYOUT_BASE_URL", "PAYOUT_MODEL"];
const saved: Record<string, string | undefined> = {};

// ───────────────────────── one product fixture (more can be added beside it) ─────────────────────────
const URL_ = "https://drops.example/";
const fieldTest: FieldTestSummary = {
  ran: true, startUrl: URL_, mode: "interactive", classification: null, limitation: null, durationMs: 40_000,
  pages: [{ url: URL_, title: "Drops", h1: "Send a gift to anyone", ctas: ["Log in", "Start a drop", "Pricing"], forms: [], consoleErrors: [], brokenRequests: [], jsOnly: false, screenshot: null, visibleTextExcerpt: "Send a gift to anyone\nA drop is a gift link you send to a friend.\nStart a drop\nPricing" }],
  states: [
    { trigger: "initial load", screenshot: null, visibleTextExcerpt: "Send a gift to anyone\nStart a drop", notableElements: [{ tag: "button", text: "Start a drop", role: "button" }], pixelDeltaPct: 100, url: URL_ },
    { trigger: 'clicked "Start a drop"', screenshot: null, visibleTextExcerpt: "Who is it for?\nAdd a note\nContinue", notableElements: [{ tag: "button", text: "Continue", role: "button" }], pixelDeltaPct: 60, url: `${URL_}new` },
  ],
} as unknown as FieldTestSummary;
const map = {
  productName: "Drops", category: "consumer app", valueProp: "Send a gift to anyone with a link.", targetUserHypotheses: [], founderTargetUsers: "",
  primaryJourney: [], routes: [], interactiveSurfaces: [], trustSurfaces: [], claimRisks: [], observedStates: [], repoOnlyCapabilities: [],
  browserConfirmed: [], limitations: [], openQuestions: [], pagesInspected: 1, repoFilesInspected: 0, digest: "0x00", fieldTest,
} as unknown as ProductMapV1;
const scope = scopeFromObservations([], [], fieldTest);
const corpus = buildObservationCorpus([], fieldTest);
const founder = { productUrl: URL_, goal: "see if people can start a drop", targetUsers: "", totalBudgetBase: BigInt(20_000_000), tokenDecimals: 6 };

const mission: CandidateMission = {
  missionKey: "start-a-drop",
  title: "Start a drop from the home page",
  objective: "Start a drop from the home page and report what the screen that follows asks for.",
  instructions: "1. Open https://drops.example/\n2. Click Start a drop.\n3. Report what the screen that follows asks you for.",
  targetSurface: URL_,
  criteria: ["After you click Start a drop, the next screen asks who the gift is for.", "The tester reports the words on the button at the bottom of that screen."],
  evidenceRequirements: ["What did the screen after Start a drop ask you for?", "What were the words on the button at the bottom?"],
  whyItMatters: "Starting a drop is the whole product.",
  sources: [{ kind: "page", ref: URL_, observation: "the Start a drop button" }],
  priority: "high", riskCategory: "critical_journey", effortMinutes: 5, conditions: [], rewardWeight: 5, maxCompletions: 3,
  verificationMethod: "Sage matches the account against the screens it saw.", confidence: 0.8, assumptions: [], disallowed: [],
  anchors: ["Start a drop", "Who is it for?"],
};
const CORE = { mainAction: "start a drop", startsAt: "Start a drop", rank: "lead", purpose: "You most likely want to know whether people can start a drop.", why: "You named starting a drop." };
const DRAFT = {
  kind: "gig", title: "Translate the onboarding guide", who: "a translator", slots: 1,
  milestones: [{
    title: "Spanish onboarding guide",
    deliverable: "The onboarding guide exists in Spanish on a public page.",
    instructions: "1. Translate every section. 2. Publish it on a public page and submit the link.",
    criteria: ["The page is written in Spanish", "Every section of the guide is covered", "Written in their own words, not machine-pasted"],
    evidence: { kind: "artifact_url", allowedHosts: [], minWords: 300 },
  }],
};
const brainInput: BrainInput = {
  campaignTitle: "Ship a fix", criteria: ["did the thing"], conditionType: "approval", note: "here is my work",
  wallet: `0x${"a".repeat(40)}`, evidenceUrl: "https://example.org/pr/1", evidenceText: "the thing was done and merged", evidenceOk: true, contentSha256: null,
};
const BRIEF = {
  criteria: [{ criterion: "did the thing", met: true, confidence: 0.95, quote: "the thing was done and merged" }],
  fraudSignals: [], recommendation: "pay", reasonCode: "all_criteria_met", confidence: 0.95, summary: "verified",
};

/** What a correct model says to each prompt of the core. `laneAnswer` covers the single-prompt lanes. */
let laneAnswer: unknown = {};
const answerFor = (c: ZooCall): unknown => {
  if (c.system === ARCHITECT_SYSTEM) return { core: CORE, missions: [mission] };
  if (c.system === CRITIC_SYSTEM) return { critiques: [] };
  if (c.system === CORE_DECISION_SYSTEM) return { core: CORE };
  return laneAnswer;
};

type Outcome = "valid" | "plain";
interface Row { lane: string; behaviour: Behaviour; outcome: Outcome; seconds: number; primary: number; fallback: number }
const rows: Row[] = [];

beforeEach(() => {
  for (const k of [...Object.keys(ENV), ...CLEARED]) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, ENV);
  resetWireMemory();
  resetModelHealth();
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
afterAll(() => {
  if (!process.env.ZOO_TABLE) return;
  console.log(["lane | behaviour | outcome | seconds | primary calls | fallback calls", ...rows.map((r) => `${r.lane} | ${r.behaviour} | ${r.outcome} | ${r.seconds} | ${r.primary} | ${r.fallback}`)].join("\n"));
});

const zooWith = (primaryHost: string, b: Behaviour) => {
  const zoo = new Zoo(answerFor).set(primaryHost, b);
  zoo.install();
  return zoo;
};
const note = (lane: string, behaviour: Behaviour, outcome: Outcome, ms: number, zoo: Zoo, primaryHost: string) =>
  rows.push({ lane, behaviour, outcome, seconds: Math.round(ms / 1000), primary: zoo.callsTo(primaryHost), fallback: zoo.callsTo(FALLBACK_HOST) });
const MONEY_KEYS = ["rewardUsd", "amount", "payout", "totalBudget", "reward", "rewardBase"];

// ───────────────────────── mission design, end to end through the gate ─────────────────────────
describe("mission design (architect, critic, core place, the gate) on every behaviour", () => {
  const design = () => runMissionBrain(map, founder, scope, corpus, { runGroundedShadow: false });

  it.each(BEHAVIOURS)("%s on the mission lane: a gated plan, inside the design's clock, in a bounded number of calls", async (b) => {
    const zoo = zooWith(MISSION_HOST, b);
    const { value: r, ms } = await onFakeClock(design);
    note("mission design", b, r.ok ? "valid" : "plain", ms, zoo, MISSION_HOST);
    // 1. a different model is one config line away, so with a healthy fallback every behaviour ends in a plan
    expect(r.ok, `${b}: ${r.reason} ${r.reasonDetail ?? ""}`).toBe(true);
    expect(r.accepted.map((m) => m.missionKey)).toContain(CORE_MISSION_KEY);
    expect(r.accepted.length).toBeGreaterThanOrEqual(2);
    // ...and it is a plan the deterministic gate accepts, whoever wrote it
    expect(validatePlanMissions(r.accepted, scope, corpus, map.observations).every((rep) => rep.ok)).toBe(true);
    // 2. the builder sees it in minutes: the design's own clock, plus the seconds of code around it
    expect(ms).toBeLessThanOrEqual(missionDesignBudgetMs() + 5_000);
    // 3. bounded calls: three architect rounds at most, their reviews, and one fallback per round and review
    expect(zoo.callsTo(MISSION_HOST)).toBeLessThanOrEqual(14);
    expect(zoo.callsTo(FALLBACK_HOST)).toBeLessThanOrEqual(8);
    // 4. no amount from a model: a mission carries no money field, whatever the model wrote beside it
    for (const m of r.accepted) for (const k of MONEY_KEYS) expect(m).not.toHaveProperty(k);
    expect(JSON.stringify(r.accepted)).not.toMatch(/500 USDC|5000 USDC/);
  }, 60_000);

  it("a model that only thinks is asked ONCE, never given more room, and the next job goes straight to the fallback", async () => {
    const zoo = zooWith(MISSION_HOST, "think_only_empty");
    const first = await onFakeClock(design);
    expect(first.value.ok).toBe(true);
    const architectAsks = () => zoo.calls.filter((c) => c.host === MISSION_HOST && c.system === ARCHITECT_SYSTEM);
    // the first job asked the thinking model for one plan, at the typical budget: no escalation, no second ask
    expect(architectAsks()).toHaveLength(1);
    expect(new Set(architectAsks().map((c) => c.maxTokens)).size).toBe(1);
    const before = zoo.calls.length;
    const second = await onFakeClock(design);
    expect(second.value.ok).toBe(true);
    // the second job: remembered, so the thinking model is not asked to design or review at all
    expect(zoo.calls.slice(before).filter((c) => c.host === MISSION_HOST)).toHaveLength(0);
    expect(second.ms).toBeLessThan(60_000);
    expect(second.value.provider).toBe(FALLBACK_HOST);
  }, 60_000);

  it("with NO fallback configured, a model that only thinks fails honestly after one ask, not five", async () => {
    for (const k of ["LLM_FALLBACK_API_KEY", "LLM_FALLBACK_BASE_URL", "LLM_FALLBACK_MODEL"]) delete process.env[k];
    const zoo = zooWith(MISSION_HOST, "think_only_unclosed");
    const { value: r, ms } = await onFakeClock(design);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("model_overthinks");
    expect(r.accepted).toEqual([]); // never a made-up plan
    expect(zoo.callsTo(MISSION_HOST)).toBe(1);
    expect(ms).toBeLessThanOrEqual(missionDesignBudgetMs());
  }, 60_000);

  it("with NO fallback, a provider that never answers ends at the design's deadline with an honest failure", async () => {
    for (const k of ["LLM_FALLBACK_API_KEY", "LLM_FALLBACK_BASE_URL", "LLM_FALLBACK_MODEL"]) delete process.env[k];
    const zoo = zooWith(MISSION_HOST, "very_slow");
    const { value: r, ms } = await onFakeClock(design);
    expect(r.ok).toBe(false);
    expect(["provider_timeout", "design_deadline"]).toContain(r.reason);
    expect(ms).toBeLessThanOrEqual(missionDesignBudgetMs() + 5_000);
    expect(zoo.callsTo(MISSION_HOST)).toBeLessThanOrEqual(2);
  }, 60_000);

  it("at the deadline the plan that is READY ships: a slow review does not hold a plan the gate accepts", async () => {
    process.env.MISSION_DESIGN_BUDGET_MS = "60000";
    // the architect answers; every later call on the lane hangs, and so does the fallback
    let asked = 0;
    const zoo = new Zoo(answerFor);
    const hang = new Zoo(answerFor).set(MISSION_HOST, "very_slow").set(FALLBACK_HOST, "very_slow").set(SHARED_HOST, "very_slow");
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => (asked++ === 0 ? zoo.fetch(url, init) : hang.fetch(url, init)));
    const { value: r, ms } = await onFakeClock(design);
    expect(r.ok).toBe(true);
    expect(r.accepted.map((m) => m.missionKey)).toEqual([CORE_MISSION_KEY, "start-a-drop"]);
    expect(ms).toBeLessThanOrEqual(65_000);
  }, 60_000);
});

// ───────────────────────── the small questions on the shared chain ─────────────────────────
describe("the core's place, the first look, the findings and the draft on every behaviour", () => {
  /**
   * Where the documented plain version is the right end even with a healthy fallback:
   *  - an EMPTY ACCOUNT on work nobody is paid on is not routed around (steady.ts, 21 Nov 2026): the builder
   *    still gets the plain wording, and the operator is told to top up;
   *  - a model that INVENTS FIELD NAMES answered; its answer is refused, never repaired, and never re-asked
   *    of another model as if the provider had failed;
   *  - a findings answer CUT MID-WAY is unparseable: the plain report stands.
   */
  const SMALL_MAY_BE_PLAIN: Behaviour[] = ["empty_account", "invents_fields"];
  it.each(BEHAVIOURS)("%s: the core-place question answers or keeps the defaults, quickly", async (b) => {
    const zoo = zooWith(SHARED_HOST, b);
    const { value: place, ms } = await onFakeClock(() => askCorePlace({ goal: founder.goal, targetUsers: "", budgetAnswers: 20, map, missions: [mission], corpus }));
    const outcome: Outcome = place.decision.from === "model" ? "valid" : "plain";
    note("core place", b, outcome, ms, zoo, SHARED_HOST);
    // a fallback that answers means the builder's purpose is read on every provider failure
    if (!SMALL_MAY_BE_PLAIN.includes(b)) expect(outcome).toBe("valid");
    expect(place.decision.rank).toBe("lead"); // the model's rank, or the default: the core leads
    expect(ms).toBeLessThanOrEqual(45_000);
    expect(zoo.calls.length).toBeLessThanOrEqual(4);
  }, 30_000);

  it.each(BEHAVIOURS)("%s: the first look is worded or stays Sage's plain one, and never throws", async (b) => {
    laneAnswer = {};
    const zoo = zooWith(SHARED_HOST, b);
    const plain = plainLookFor(map, URL_);
    const withProblem = { ...plain, problems: plain.problems.length ? plain.problems : [{ id: "p1", title: "x", fix: "y", evidence: [] }] } as typeof plain;
    const { value: look, ms } = await onFakeClock(() => wordFirstLook(withProblem, map, { modelConfigured: () => true }));
    note("first look", b, look.engine === "plain" || look === withProblem ? "plain" : "valid", ms, zoo, SHARED_HOST);
    // the set of problems is Sage's own, whatever the model said
    expect(look.problems.map((p) => p.id)).toEqual(withProblem.problems.map((p) => p.id));
    expect(ms).toBeLessThanOrEqual(180_000);
    // a capped key is waited on inside each call (the wire re-sends), so its bound is the widest
    expect(zoo.calls.length).toBeLessThanOrEqual(10);
  }, 30_000);

  it.each(BEHAVIOURS)("%s: the findings' grouping call (REPORT lane) answers or throws for the plain report, bounded", async (b) => {
    laneAnswer = { findings: [], understood: [] };
    const zoo = zooWith(SHARED_HOST, b);
    const ask = () =>
      completeSteadily(llmCompleteJson, { system: "group", user: "answers", maxTokens: 2600, temperature: 0.2, lane: "REPORT", tag: "report", maxWaitMs: 90_000 }, { attempts: 3, budgetMs: 90_000, label: "report" }).then(
        () => "valid" as const,
        () => "plain" as const,
      );
    const { value: outcome, ms } = await onFakeClock(ask);
    note("findings", b, outcome, ms, zoo, SHARED_HOST);
    if (![...SMALL_MAY_BE_PLAIN, "cut_mid_answer"].includes(b)) expect(outcome).toBe("valid");
    expect(ms).toBeLessThanOrEqual(200_000);
    expect(zoo.calls.length).toBeLessThanOrEqual(10);
  }, 30_000);

  /** a shape the drafter cannot read is the model's own miss: the founder is told so and fills the job in */
  const DRAFT_MAY_BE_PLAIN: Behaviour[] = ["invents_fields"];
  it.each(BEHAVIOURS)("%s: a founder's draft comes back while they wait, or the honest plain message", async (b) => {
    laneAnswer = DRAFT;
    const zoo = zooWith(SHARED_HOST, b);
    const { value: r, ms } = await onFakeClock(() => draftDirectCampaign({ intent: "Translate our 800-word onboarding guide into Spanish for our LatAm users." }));
    note("draft", b, r.ok ? "valid" : "plain", ms, zoo, SHARED_HOST);
    if (!DRAFT_MAY_BE_PLAIN.includes(b)) expect(r.ok, JSON.stringify(r).slice(0, 200)).toBe(true);
    // a person is waiting: a minute at the very most, and usually seconds
    expect(ms).toBeLessThanOrEqual(60_000);
    expect(zoo.calls.length).toBeLessThanOrEqual(8);
    // no amount from a model: the draft's schema has no money in it, and invented money fields are dropped
    expect(JSON.stringify(r)).not.toMatch(/500 USDC|rewardUsd/);
  }, 30_000);
});

// ───────────────────────── judgment: who decides money never changes ─────────────────────────
describe("the judges on every behaviour", () => {
  it.each(BEHAVIOURS)("%s: the observation judge answers, or returns the zero that cannot pay", async (b) => {
    laneAnswer = { obsConfidence: 0.9, contradictions: [], corroborations: [] };
    const zoo = zooWith(OBS_HOST, b);
    const { value: r, ms } = await onFakeClock(() =>
      judgeObservationAccount({ account: "I clicked Start a drop and it asked who the gift is for.", missionObjective: mission.objective, criteria: mission.criteria, privateObservations: ["Who is it for?", "Start a drop"] }),
    );
    note("observation judge", b, r.obsConfidence > 0 ? "valid" : "plain", ms, zoo, OBS_HOST);
    // it has no second judge by design: the SAME model is asked (at most twice), never the fallback
    expect(zoo.callsTo(FALLBACK_HOST)).toBe(0);
    expect(zoo.callsTo(OBS_HOST)).toBeLessThanOrEqual(8);
    expect(r.obsConfidence === 0 || r.obsConfidence === 0.9).toBe(true);
    expect(ms).toBeLessThanOrEqual(310_000);
  }, 30_000);

  it.each(BEHAVIOURS)("%s: the payout judge returns a brief; only a model's own strict answer is engine llm", async (b) => {
    laneAnswer = BRIEF;
    const zoo = new Zoo(answerFor).set(PAYOUT_HOST, b);
    const primary = { endpoint: `https://${PAYOUT_HOST}/v1/chat/completions`, key: "k-payout", model: REASONING, host: PAYOUT_HOST };
    const fallback = { endpoint: `https://${FALLBACK_HOST}/v1/chat/completions`, key: "k-fallback", model: FAST, host: FALLBACK_HOST };
    const { value: brief, ms } = await onFakeClock(() => verifySubmission(brainInput, { provider: primary, fallback, fetchImpl: zoo.fetch as unknown as typeof fetch }));
    note("payout judge", b, brief.engine === "llm" ? "valid" : "plain", ms, zoo, PAYOUT_HOST);
    // bounded: three attempts on the judge, one on the fallback (each may be re-sent once per refused parameter)
    expect(zoo.callsTo(PAYOUT_HOST)).toBeLessThanOrEqual(16);
    expect(zoo.callsTo(FALLBACK_HOST)).toBeLessThanOrEqual(3);
    expect(ms).toBeLessThanOrEqual(240_000);
    // quotes are verbatim, or they are gone
    for (const c of brief.criteria) if (c.quote) expect(brainInput.evidenceText).toContain(c.quote);
    // no amount from a model
    for (const k of MONEY_KEYS) expect(brief).not.toHaveProperty(k);
    if (brief.engine === "llm") {
      // the brief names who actually judged, so a fallback's judgment is never mistaken for the pinned judge's
      expect([PAYOUT_HOST, FALLBACK_HOST]).toContain(brief.provider);
      expect(brief.model).toBe(brief.provider === PAYOUT_HOST ? REASONING : FAST);
      // ...and an identity that is not the approved one cannot pay, exactly as before
      expect(identityOf(brief).model).toBe(brief.model);
      expect(judgeIdentityGate(brief, true)).toMatchObject({ pay: false, blocked: "judge_identity_unapproved" });
    } else {
      // the heuristic can never pay: it is not engine "llm", which the autopilot gate requires
      expect(brief.engine).toBe("heuristic");
      expect(brief.model ?? null).toBeNull();
    }
  }, 30_000);
});

describe("eyes", () => {
  it("a model that takes images but is blind is never given Sage's screenshots", () => {
    process.env.VISION_API_KEY = "k-vision";
    process.env.VISION_BASE_URL = `https://${MISSION_HOST}/v1`;
    process.env.VISION_MODEL = REASONING; // MiniMax: accepts image_url, answers 200, reports seeing no image
    expect(resolveVisionProvider()).toBeNull();
    process.env.VISION_MODEL = "qwen/qwen3-vl-plus";
    expect(resolveVisionProvider()).toMatchObject({ model: "qwen/qwen3-vl-plus" });
  });
});
