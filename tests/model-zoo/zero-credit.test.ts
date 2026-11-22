// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SAGE AT ZERO MODEL CREDIT, THE WHOLE PATH, OFFLINE (22 Nov 2026).
 *
 * "Never fails on any model" includes none: an empty account, a spent key, every provider broken, a model
 * that thinks its budget away, or no model configured. This file walks what a builder and a tester do, in
 * order, with the zoo answering every model call the way a provider with no credit does:
 *
 *   paste → inspection → plan → approve → pay → the test's page → an answer → the hold → the builder's
 *   release → the findings → first users
 *
 * Everything between is production's own code: the inspection job, the mission brain and its gate, the
 * frozen allocator, the approval check, the record of the test (the same builder the account launch and the
 * own-wallet launch use), the payout pipeline with its real decision and observation judge, the release, the
 * report and the first-users drafts. Only the outside world is substituted: pages are saved HTML, the browser
 * run is a recorded summary, the chain is the fixture adapter the pipeline suites use, and the model is the
 * zoo. No network, no key, no live model.
 *
 * What it holds:
 *  - a gated first-try plan exists for a website and for a kind where people do the try, in every mode;
 *  - the honesty line is on the plan and on the test's page, for the builder and for the tester;
 *  - nothing is paid without the builder, even an answer the deterministic matcher alone would have paid;
 *  - the builder's release pays, and the findings and the first-users drafts are built with no model;
 *  - a model that DID answer, and whose missions the gate refused, still ends in a question (never this plan).
 */
const hoisted = vi.hoisted(() => ({
  fieldTest: null as unknown,
  inspections: [] as { result: unknown }[],
}));

vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));
vi.mock("@/lib/launch/field-test", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/launch/field-test")>()),
  fieldTestEnabled: () => hoisted.fieldTest !== null,
  runFieldTest: async () => hoisted.fieldTest,
}));
vi.mock("@/lib/launch/field-test-progress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/launch/field-test-progress")>()),
  recordFieldTestStep: async () => {},
}));
vi.mock("@/lib/launch/inspect", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/launch/inspect")>();
  return {
    ...real,
    inspectProduct: async (...args: Parameters<typeof real.inspectProduct>) => {
      const result = await real.inspectProduct(...args);
      hoisted.inspections.push({ result });
      return result;
    },
  };
});
// The chain, as the pipeline suites substitute it: only the transport. Every safety-bearing line is real.
vi.mock("@/lib/deputy/signer", () => ({
  ensureVendorApproved: vi.fn(async () => {
    throw new Error("a V2 payout never allowlists");
  }),
  submitRequestSpend: vi.fn(),
  awaitSpendOutcome: vi.fn(),
  operatorAddress: vi.fn(() => "0x7704E5BEe00Ef085dde85EEB0c49ae12d9F9BC35"),
  sendVaultWrite: vi.fn(),
}));
vi.mock("@/lib/deputy/chain", () => ({
  getVaultState: vi.fn(async () => ({ status: "active", budget: 100, spent: 0, remaining: 100, perTxCap: 100, velocityCap: 100 })),
  isVendorApproved: vi.fn(async () => true),
  isIntentUsed: vi.fn(async () => false),
  findSettleTxByIntent: vi.fn(async () => null),
  publicClient: vi.fn(),
}));
vi.mock("@/lib/deputy/chain-freshness", async (orig) => ({
  ...(await orig<typeof import("@/lib/deputy/chain-freshness")>()),
  readChainFreshness: vi.fn(async () => ({ fresh: true, blockNumber: 1, headAgeSeconds: 2, reason: "current" as const })),
}));
vi.mock("@/lib/campaigns/reconcile", () => ({ reconcileVendorEvents: vi.fn(async () => null) }));
vi.mock("@/lib/telegram/bot", async (orig) => ({
  ...(await orig<typeof import("@/lib/telegram/bot")>()),
  sendTelegram: vi.fn(async () => {}),
  announceCampaignSettled: vi.fn(),
  announceCampaignBlocked: vi.fn(),
}));
vi.mock("@/lib/deputy/notify", () => ({ notifyTelegram: vi.fn() }));

import { getAddress, type Address } from "viem";
import { onFakeClock, Zoo, type Behaviour, type ZooCall } from "./zoo";
import { makeFakeAdapter, V2_OPERATOR, V2_TOKEN, type V2Fixture } from "@/lib/campaigns/campaign-v2.fixture";
import { buildHeldTriage } from "@/lib/campaigns/held-triage";
import { decodeDetail } from "@/lib/campaigns/journal";
import { listHeldSubmissions, releaseSubmission } from "@/lib/campaigns/review-actions";
import { settleByRail } from "@/lib/campaigns/settle-dispatch";
import { attachV2Campaign, computeV2SetupPreview, type V2SetupInput } from "@/lib/campaigns/v2-setup";
import type { ChainCampaignSnapshot } from "@/lib/campaigns/vault-agreement";
import { CORE_MISSION_KEY } from "@/lib/core-test/shape";
import { createSubmission, getCampaign, getDecisionBySubmission, getLatestSubmissionEvent, getSubmission, listMissions, updateCampaignAutonomy } from "@/lib/db/campaigns";
import { createInspectionJob, getInspectionJob } from "@/lib/db/inspection";
import { approveRevision, getCurrentRevision } from "@/lib/db/plan-revisions";
import type { CampaignVaultAdapter } from "@/lib/deputy/campaign-vault";
import { observationFromRow } from "@/lib/deputy/decisions";
import { runDeputyOnSubmission } from "@/lib/deputy/pipeline";
import { JUDGE_AWAY_LINE } from "@/lib/deputy/reason-copy";
import { plainLookFor } from "@/lib/first-look";
import { verifyPlanForApproval } from "@/lib/launch/approve";
import { loadApprovedPlan } from "@/lib/launch/deployment-service";
import type { InspectResult } from "@/lib/launch/inspect";
import { jobToView, runInspectionJob } from "@/lib/launch/job";
import { FIXED_WORDS_MODEL } from "@/lib/launch/mission-brain";
import { ARCHITECT_SYSTEM, CRITIC_SYSTEM, MISSION_PROMPT_VERSION } from "@/lib/launch/mission-prompt";
import { NO_MODEL_BUILDER_LINE, NO_MODEL_PLAN, NO_MODEL_TESTER_LINE } from "@/lib/launch/no-model";
import { inspectAndPlan } from "@/lib/launch/pipeline";
import { KIND_PLAYBOOK } from "@/lib/launch/product-kind";
import { scopeFromObservations } from "@/lib/launch/product-map";
import type { FieldTestSummary } from "@/lib/launch/schemas";
import { deserializePlan } from "@/lib/launch/serde";
import { anchorIssues, buildObservationCorpus, classifyVerifiability, validatePlanMissions } from "@/lib/launch/validate-mission";
import { resetModelHealth } from "@/lib/llm/model-health";
import { resetWireMemory } from "@/lib/llm/wire";
import { campaignSetupInput } from "@/lib/privy/deploy-runner";
import { findingsView } from "@/lib/report";
import { noModelReply } from "@/lib/telegram/no-model-reply";
import { liveView } from "@/lib/test-page/live";

const HOSTS = ["mission.zoo.test", "shared.zoo.test", "fallback.zoo.test"];
const FAST = "openai/gpt-5.4-mini-2026-03-17";
const ENV: Record<string, string> = {
  LLM_API_KEY: "k-shared", LLM_BASE_URL: "https://shared.zoo.test/v1", LLM_MODEL: FAST,
  LLM_FALLBACK_API_KEY: "k-fallback", LLM_FALLBACK_BASE_URL: "https://fallback.zoo.test/v1", LLM_FALLBACK_MODEL: FAST,
  MISSION_API_KEY: "k-mission", MISSION_BASE_URL: "https://mission.zoo.test/v1", MISSION_MODEL: FAST,
};
const CLEARED = ["COMMONSTACK_API_KEY", "COMMONSTACK_BASE_URL", "DEPUTY_MODEL", "LLM_TIMEOUT_MS", "LLM_DAILY_BUDGET_USD", "LLM_RETRY_MAX_WAIT_MS", "MISSION_GROUNDING_MODE", "MISSION_DESIGN_BUDGET_MS", "MISSION_HEDGE_AFTER_MS",
  "INSPECTION_REPLAY_MODE", "FIELD_TEST_ENABLED", "OBS_JUDGE_API_KEY", "OBS_JUDGE_BASE_URL", "OBS_JUDGE_MODEL", "DRAFT_API_KEY", "DRAFT_BASE_URL", "DRAFT_MODEL", "VISION_API_KEY", "VISION_BASE_URL", "VISION_MODEL",
  "PAYOUT_API_KEY", "PAYOUT_BASE_URL", "PAYOUT_MODEL", "CONCIERGE_API_KEY", "CONCIERGE_BASE_URL", "CONCIERGE_MODEL", "REPORT_API_KEY", "REPORT_BASE_URL", "REPORT_MODEL",
  "OBSERVATION_AUTOPAY", "DEPUTY_AUTOPILOT_MAINNET", "IDENTITY_DOOR", "IDENTITY_TIERS", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];
const saved: Record<string, string | undefined> = {};

const PAGES_DIR = path.join(process.cwd(), "tests", "model-zoo", "pages");
/** pages a test writes for itself, served by the same stub as the saved ones */
const written = new Map<string, string>();
const pageHtml = (name: string): string => written.get(name) ?? readFileSync(path.join(PAGES_DIR, `${name}.html`), "utf8");
/** the observation judge's call, by its own first words (its prompt is not exported, and need not be) */
const isJudge = (c: ZooCall): boolean => c.system.startsWith("You are Sage's OBSERVATION VERIFIER");

const DROPS = "https://getdrops.app/";
const BOT = "https://t.me/pricewatch_bot";
const PAGES: Record<string, string> = { [DROPS]: "website", [`${DROPS}new`]: "website-new", [BOT]: "telegram-bot" };

/** How a provider with nothing to give behaves, as measured (zoo.ts), plus no provider at all. */
type Mode = Extract<Behaviour, "empty_account" | "capped_429" | "always_500" | "think_only_empty"> | "no_model_configured";
const MODES: Mode[] = ["empty_account", "capped_429", "always_500", "think_only_empty", "no_model_configured"];

interface Outside { zoo: Zoo; judgeAsks: ZooCall[]; other: string[] }

function outside(mode: Mode | "healthy", answer: (c: ZooCall) => unknown = () => ({})): Outside {
  const judgeAsks: ZooCall[] = [];
  const other: string[] = [];
  const zoo = new Zoo((c) => {
    if (isJudge(c)) judgeAsks.push(c);
    return answer(c);
  });
  if (mode !== "no_model_configured" && mode !== "healthy") for (const h of HOSTS) zoo.set(h, mode);
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (new URL(url).host.endsWith(".zoo.test")) return zoo.fetch(input, init);
    const name = PAGES[url.replace(/#.*$/, "")];
    if (!name) other.push(url);
    return new Response(name ? pageHtml(name) : "<title>Not found</title>", { status: name ? 200 : 404, headers: { "content-type": "text/html; charset=utf-8" } });
  });
  return { zoo, judgeAsks, other };
}

/** What Sage's browser saw on Drops: the first screen, then three screens behind it. */
const BROWSER = {
  ran: true, startUrl: DROPS, mode: "interactive", classification: null, limitation: null, durationMs: 30_000,
  pages: [{ url: DROPS, title: "Drops: send a gift to anyone", h1: "Send a gift to anyone", ctas: ["Pricing", "Log in", "Start a drop"], forms: [], consoleErrors: [], brokenRequests: [], jsOnly: false, screenshot: null, visibleTextExcerpt: "Send a gift to anyone\nA drop is a gift link you send to a friend.\nStart a drop" }],
  states: [
    { trigger: "initial load", screenshot: null, visibleTextExcerpt: "Send a gift to anyone\nA drop is a gift link you send to a friend. They open it and choose what they want.\nStart a drop\nHow it works", notableElements: [{ tag: "a", text: "Start a drop", role: "link" }], pixelDeltaPct: 100, url: DROPS },
    { trigger: 'clicked "Start a drop"', screenshot: null, visibleTextExcerpt: "Who is it for?\nAdd a note for your friend, then continue to pick an amount.\nRecipient nickname\nContinue", notableElements: [{ tag: "button", text: "Continue", role: "button" }], pixelDeltaPct: 70, url: `${DROPS}new` },
    { trigger: 'clicked "Continue"', screenshot: null, visibleTextExcerpt: "Pick an amount\nFive dollars\nTen dollars\nTwenty dollars\nYour friend chooses a treat worth this much\nPreview the link", notableElements: [{ tag: "button", text: "Preview the link", role: "button" }], pixelDeltaPct: 65, url: `${DROPS}new/amount` },
    { trigger: 'clicked "Preview the link"', screenshot: null, visibleTextExcerpt: "Your drop is ready to share\nCopy the gift link\nIt opens a wrapped parcel with a ribbon\nNothing is charged until your friend chooses", notableElements: [{ tag: "button", text: "Copy the gift link", role: "button" }], pixelDeltaPct: 60, url: `${DROPS}new/preview` },
  ],
} as unknown as FieldTestSummary;

/** An honest try in the tester's own words: it names almost nothing in Sage's exact wording. */
const OWN_WORDS =
  "It looked to me like a way of mailing somebody a present through a web address, aimed at people who forget birthdays. The big orange button was the only thing I noticed up top. " +
  "I pressed it and got asked whose present this was, typed my sister's nickname, moved on, chose the middle price, and ended on a page offering me an address to paste into a chat. I stopped there because I did not want to bother her. " +
  "I would come back before a birthday if it showed what she can choose from.";
/** An answer that repeats the screens behind the first one in the product's own words: the matcher clears it alone. */
const EXACT_WORDS =
  "I took it to be a gift link you send to a friend. On the first screen the button says Start a drop. " +
  "After that it asked Who is it for? and wanted a Recipient nickname, then Add a note for your friend. Next I had to Pick an amount: Five dollars, Ten dollars or Twenty dollars, and it said Your friend chooses a treat worth this much. " +
  "I pressed Preview the link and landed on Your drop is ready to share with Copy the gift link, where It opens a wrapped parcel with a ribbon and Nothing is charged until your friend chooses. I stopped there. I would use it again for a birthday.";

const FOUNDER = getAddress("0xb77e6f5466cf52524e8465859277f192Be0bCfe4");
const VAULT_FACTORY = getAddress("0x0000000000000000000000000000000000005678");
const BUDGET = BigInt(10_000_000);
let seq = 0;
const table: string[] = [];

beforeEach(() => {
  for (const k of [...Object.keys(ENV), ...CLEARED]) { saved[k] = process.env[k]; delete process.env[k]; }
  hoisted.fieldTest = null;
  hoisted.inspections.length = 0;
  resetWireMemory();
  resetModelHealth();
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
afterAll(() => {
  if (process.env.ZOO_TABLE) process.stdout.write(`${["mode | product | seconds (fake clock) | model calls | why no model | step 3 of the mission", ...table].join("\n")}\n`);
});

const arm = (mode: Mode | "healthy"): void => {
  if (mode !== "no_model_configured") Object.assign(process.env, ENV);
};

/* ──────────────────────────────────────────── 1. the plan, in every mode ── */

interface PlanRow { name: string; url: string; browser: boolean; step3: string; anchors: number }
const PLAN_ROWS: PlanRow[] = [
  { name: "a website Sage tried in its browser", url: DROPS, browser: true, step3: "3. Now try to start a drop, starting from “Start a drop”. Go as far as you can.", anchors: 4 },
  { name: "a website read with no browser", url: DROPS, browser: false, step3: "3. Now try to start a drop, starting from “Start a drop”. Go as far as you can.", anchors: 4 },
  { name: "a Telegram bot (people do the try)", url: BOT, browser: false, step3: "3. Now open @pricewatch_bot in Telegram, press Start, and try to start it and use its main command.", anchors: 3 },
];

describe("a gated first-try plan exists with no model, for a website and for a kind people try", () => {
  it.each(MODES.flatMap((mode) => PLAN_ROWS.map((row) => ({ mode, ...row }))))("$mode: $name", async ({ mode, name, url, browser, step3, anchors }) => {
    arm(mode);
    hoisted.fieldTest = browser ? BROWSER : null;
    const out = outside(mode);
    const { value: r, ms } = await onFakeClock(() =>
      inspectAndPlan({ productUrl: url, goal: "see whether strangers get it and can try it", targetUsers: "", totalBudgetBase: BUDGET, tokenDecimals: 6 }, `zero-${mode}-${++seq}`, () => {}, 1, browser ? { inspectionId: `zero-${seq}` } : {}),
    );

    // A PLAN, never "Sage's reviewer was briefly unavailable" and never a question
    expect(r.stage, `${r.reason} ${JSON.stringify(r.questions)}`).toBe("ready");
    expect(r.questions).toEqual([]);
    const brain = r.brain!;
    const plan = r.plan!;

    // it is the first-try mission alone, in Sage's fixed words, and it says no model had a part in it
    expect(brain.accepted.map((m) => m.missionKey)).toEqual([CORE_MISSION_KEY]);
    expect(plan.missions.map((m) => m.missionKey)).toEqual([CORE_MISSION_KEY]);
    expect(brain.withoutModel).toBeTruthy();
    expect(brain.model).toBe(NO_MODEL_PLAN);
    expect(plan.modelVersion).toBe(NO_MODEL_PLAN);
    expect(plan.promptVersion).toBe(MISSION_PROMPT_VERSION);
    const first = brain.accepted[0]!;
    expect(first.instructions.split("\n")[2]).toContain(step3);
    expect(classifyVerifiability(first)).toBe("observation-based");

    // THE SAME GATE, and every anchor is text Sage really read (anchor integrity 100%)
    const inspection = hoisted.inspections[0]!.result as InspectResult;
    const scope = scopeFromObservations(inspection.observations, [], r.map!.fieldTest);
    const corpus = buildObservationCorpus(inspection.observations, r.map!.fieldTest);
    expect(validatePlanMissions(brain.accepted, scope, corpus, r.map!.observations).every((rep) => rep.ok)).toBe(true);
    expect(first.anchors!.length).toBeGreaterThanOrEqual(anchors);
    expect(anchorIssues(first, corpus)).toEqual([]);

    // THE MONEY is the allocator's, exactly; no model stated any of it (none spoke)
    const total = plan.missions.reduce((sum, m) => sum + m.rewardBase * m.maxCompletions, BigInt(0));
    expect(total).toBe(plan.allocatedBase);
    expect(plan.allocatedBase > BigInt(0) && plan.allocatedBase <= BUDGET).toBe(true);

    // Sage's first look is the plain one, and it stands
    expect(plainLookFor(r.map!, url).read).toBeTruthy();

    // BOUNDED: inside the design's one clock, and no ladder of retries against a closed account
    expect(ms).toBeLessThanOrEqual(430_000);
    expect(out.zoo.calls.length).toBeLessThanOrEqual(mode === "no_model_configured" ? 0 : 20);
    if (mode === "empty_account") {
      expect(ms).toBeLessThanOrEqual(5_000);
      expect(out.zoo.calls.length).toBeLessThanOrEqual(3);
    }
    // no network but the saved pages
    for (const u of out.other) expect(new URL(u).host).toBe(new URL(url).host);

    table.push(`${mode} | ${name} | ${Math.round(ms / 1000)} | ${out.zoo.calls.length} | ${brain.withoutModel!.reason} | ${first.instructions.split("\n")[2]!.slice(0, 96)}`);
  }, 120_000);

  it("the main action comes from the product's own words: its call to action, then its heading's verb, then the sentence that fits anything", async () => {
    arm("no_model_configured");
    const run = async (page: string) => {
      PAGES["https://ladder.example/"] = page;
      PAGES["https://ladder.example/go"] = "ladder-go";
      outside("no_model_configured");
      const { value: r } = await onFakeClock(() => inspectAndPlan({ productUrl: "https://ladder.example/", goal: "", targetUsers: "", totalBudgetBase: BUDGET, tokenDecimals: 6 }, `ladder-${++seq}`, () => {}, 1, {}));
      vi.unstubAllGlobals();
      return r.stage === "ready" ? r.brain!.accepted[0]!.instructions.split("\n")[2]! : `${r.stage}:${r.reason}`;
    };
    const html = (h1: string, cta: string) => `<!doctype html><html><head><title>Tally Notes</title></head><body><header><a href="/pricing">Pricing</a> <a href="/login">Log in</a></header><main><h1>${h1}</h1><p>Tally Notes keeps every receipt from a trip in one shared list, so nobody has to chase anyone for money afterwards.</p><a class="btn" href="/go">${cta}</a><h2>How it works</h2><p>Photograph a receipt, tag who was there, and the list shows who owes what at the end of the trip.</p></main></body></html>`;
    const write = (name: string, body: string) => void written.set(name, body);
    write("ladder-go", `<!doctype html><html><head><title>New trip | Tally Notes</title></head><body><main><h1>Name your trip</h1><p>Give the trip a name and add the people who came along, then photograph the first receipt.</p><button>Add a person</button></main></body></html>`);
    write("ladder-cta", html("Receipts, sorted", "Create a shared list"));
    write("ladder-heading", html("Share a trip's receipts fairly", "Get started"));
    write("ladder-none", html("Receipts, sorted", "Get started"));
    write("ladder-slogan", html("Start saving time today", "Get started"));
    expect(await run("ladder-cta")).toContain("3. Now try to create a shared list, starting from “Create a shared list”.");
    // "Get started" names no action: the heading does, and the door is where the generic sentence would start
    expect(await run("ladder-heading")).toContain("3. Now try to share a trip's receipts fairly.");
    // a slogan is not an action: the sentence that fits anything is the honest one
    expect(await run("ladder-slogan")).toContain("3. Now try to do the main thing this product is for, starting from “Get started”.");
    expect(await run("ladder-none")).toContain("3. Now try to do the main thing this product is for, starting from “Get started”.");
    delete PAGES["https://ladder.example/"];
    delete PAGES["https://ladder.example/go"];
  }, 60_000);

  it("NOT when a model answered and the gate refused its missions: that is a question for the builder, as before", async () => {
    arm("healthy");
    const bad = {
      missionKey: "read-the-pricing", title: "Check the pricing page mentions a free tier",
      objective: "Confirm the pricing page mentions the Enterprise Fleet Console.", instructions: "1. Open the pricing page.\n2. Find the Enterprise Fleet Console.",
      targetSurface: "https://elsewhere.example/pricing", criteria: ["The page mentions the Enterprise Fleet Console."], evidenceRequirements: ["Quote the line."],
      whyItMatters: "x", sources: [{ kind: "page", ref: "https://elsewhere.example/pricing", observation: "x" }], priority: "high", riskCategory: "docs_consistency", effortMinutes: 5,
      conditions: [], rewardWeight: 5, maxCompletions: 3, verificationMethod: "Sage reads the page.", confidence: 0.8, assumptions: [], disallowed: [], anchors: ["Enterprise Fleet Console"],
    };
    const out = outside("healthy", (c) => (c.system === ARCHITECT_SYSTEM ? { missions: [bad] } : c.system === CRITIC_SYSTEM ? { critiques: [] } : {}));
    const { value: r } = await onFakeClock(() => inspectAndPlan({ productUrl: DROPS, goal: "see whether strangers get it", targetUsers: "", totalBudgetBase: BUDGET, tokenDecimals: 6 }, `refused-${++seq}`, () => {}, 1, {}));
    expect(out.zoo.calls.some((c) => c.system === ARCHITECT_SYSTEM)).toBe(true);
    expect(r.stage).toBe("needs_input");
    expect(r.reason).toBe("no_missions_passed_validation");
    expect(r.plan).toBeNull();
    expect(r.brain!.withoutModel).toBeUndefined();
    expect(r.questions.length).toBeGreaterThan(0);
  }, 60_000);

  it("a kind people try, on a healthy day, is still recorded as Sage's fixed words (a model named its main action)", async () => {
    arm("healthy");
    outside("healthy", () => ({ core: { mainAction: "use /price to check a token's price", startsAt: "", rank: "lead", purpose: "You most likely want to know whether strangers can use the bot.", why: "You asked whether people get it." } }));
    const { value: r } = await onFakeClock(() => inspectAndPlan({ productUrl: BOT, goal: "see whether strangers get it", targetUsers: "", totalBudgetBase: BUDGET, tokenDecimals: 6 }, `healthy-${++seq}`, () => {}, 1, {}));
    expect(r.stage).toBe("ready");
    expect(r.brain!.model).toBe(FIXED_WORDS_MODEL);
    expect(r.brain!.withoutModel).toBeUndefined();
  }, 60_000);
});

/* ───────────────────────────── 2. the whole path, from the paste to first users ── */

interface Walk { jobId: string; campaignId: string; fixture: V2Fixture; adapter: CampaignVaultAdapter; calls: { requestPayout: number }; missionIdHash: string }

function snapshotFor(input: V2SetupInput): ChainCampaignSnapshot {
  const p = computeV2SetupPreview(input);
  const missions: ChainCampaignSnapshot["missions"] = {};
  p.missions.forEach((m, i) => {
    missions[m.missionIdHash.toLowerCase()] = { exists: true, rewardBase: input.missions[i]!.rewardBase, maxCompletions: input.missions[i]!.maxCompletions };
  });
  return {
    factoryRecognizes: true, owner: input.founderAddress, operator: V2_OPERATOR, guardian: "0x0000000000000000000000000000000000000000", token: input.expectedToken,
    campaignIdHash: p.campaignIdHash as string, missionPlanDigest: p.missionPlanDigest as string, budgetCeiling: BigInt(p.totalBudgetBase), chainId: input.chainId, state: "active", replaySupport: "supported", missions,
  };
}

/** Paste → inspection → plan → approve → pay, with production's own job, approval and record of the test. */
async function pasteToLive(url: string, browser: boolean): Promise<Walk> {
  hoisted.fieldTest = browser ? BROWSER : null;
  const n = ++seq;
  const { job } = createInspectionJob({
    founderWallet: FOUNDER, publicCampaignId: `launch-zero-${n}`, productUrl: url, goal: "see whether strangers get it and can try it", targetUsers: "",
    totalBudgetBase: BUDGET, tokenDecimals: 6, planningRequestId: `prid:zero:${n}`, surface: "test",
  });
  // THE INSPECTION JOB: reads the pages, takes the first look, designs the plan, saves revision 1
  await onFakeClock(() => runInspectionJob(job.id));
  const done = getInspectionJob(job.id)!;
  expect(done.status, done.failureReason ?? "").toBe("ready");
  expect(done.model).toBe(NO_MODEL_PLAN);

  // THE PLAN'S PAGE says it once, before any money moves
  const view = jobToView(done);
  expect(view.withoutModel).toEqual({ line: NO_MODEL_BUILDER_LINE });
  expect(view.failureReason).toBeNull();
  const planOnPage = view.plan as { missions: { missionKey: string }[]; modelVersion: string };
  expect(planOnPage.missions.map((m) => m.missionKey)).toEqual([CORE_MISSION_KEY]);

  // APPROVE: every hash recomputed, the budget exact, and the mark rides on the approved plan
  const current = getCurrentRevision(job.id)!;
  const verified = verifyPlanForApproval(deserializePlan(current.planJson), { approver: FOUNDER, model: current.model, provider: current.provider, promptVersion: MISSION_PROMPT_VERSION });
  expect(verified.ok, verified.ok ? "" : verified.error).toBe(true);
  if (!verified.ok) throw new Error("unreachable");
  expect(verified.deploymentReadyPlan.withoutModel).toBe(true);
  expect(approveRevision(job.id, current.revisionNumber, FOUNDER, verified.approvalRecord).ok).toBe(true);

  // PAY: the record of the test, built by the same function the account launch and the own-wallet launch use
  const loaded = loadApprovedPlan(job.id)!;
  const vault = getAddress(`0x${(0x5000 + n).toString(16).padStart(40, "0")}`) as Address;
  const setup = campaignSetupInput(FOUNDER, loaded, job.id, { chainId: 59902, factory: VAULT_FACTORY, owner: FOUNDER, operator: V2_OPERATOR, guardian: "0x0000000000000000000000000000000000000000", token: V2_TOKEN, dailyVelocityCap: BUDGET, durationSeconds: BigInt(14 * 86_400) }, vault);
  // the builder releases each payment, as the plan's page told them, though no door asked for it
  expect(setup.autonomy).toBe("manual");
  const attached = await attachV2Campaign(setup, { adapter: { readSnapshot: async () => snapshotFor(setup) } as unknown as CampaignVaultAdapter, operatorAddress: () => V2_OPERATOR });
  expect(attached.ok, JSON.stringify(attached)).toBe(true);

  const campaign = getCampaign(setup.publicCampaignId)!;
  expect(campaign.status).toBe("live");
  expect(campaign.autonomy).toBe("manual");
  const missions = listMissions(campaign.id);
  expect(missions).toHaveLength(1);
  const fixture = { campaign, missions, mission: missions[0]! } as unknown as V2Fixture;
  const calls = { requestPayout: 0 };
  return { jobId: job.id, campaignId: campaign.id, fixture, adapter: makeFakeAdapter(fixture, { calls }), calls, missionIdHash: missions[0]!.missionIdHash };
}

const tester = (i: number): string => getAddress(`0x${(0xa11ce000 + i).toString(16).padStart(40, "0")}`);

function answer(w: Walk, wallet: string, note: string): string {
  const r = createSubmission({ campaignId: w.campaignId, wallet, note, missionIdHash: w.missionIdHash });
  if (!r.ok) throw new Error(`the answer was refused: ${r.error}`);
  return r.submission.id;
}

describe("the whole path at zero credit: paste, plan, approve, pay, answers, hold, release, findings, first users", () => {
  it.each(["empty_account", "no_model_configured"] as Mode[])("%s: a website", async (mode) => {
    arm(mode);
    // every switch that lets Sage pay alone is ON: only the builder's release stands between an answer and money
    process.env.OBSERVATION_AUTOPAY = "1";
    const out = outside(mode);
    const w = await pasteToLive(DROPS, true);
    const deps = { campaignAdapter: w.adapter, operatorAddress: () => V2_OPERATOR };

    // THE TEST'S PAGE. The builder reads the line; the tester reads who checks, and nothing Sage saw
    const owner = liveView(getCampaign(w.campaignId)!, FOUNDER);
    expect(owner.viewer).toBe("owner");
    expect(owner.withoutModel).toEqual({ line: NO_MODEL_BUILDER_LINE });
    const visitor = liveView(getCampaign(w.campaignId)!, tester(1));
    expect(visitor.withoutModel).toEqual({ line: NO_MODEL_TESTER_LINE });
    expect(visitor.frames).toEqual([]);
    expect(visitor.firstLook).toBeNull();
    expect(visitor.findings).toBeNull();
    // what to do is unchanged: the same mission card, the same four questions
    expect(visitor.missions).toHaveLength(1);
    expect(visitor.missions[0]!.missionKey).toBe(CORE_MISSION_KEY);

    // TWO TESTERS ANSWER. One in their own words; one in the product's exact words, which the deterministic
    // matcher clears with no model at all. Neither is paid: no autopay is possible on this test.
    const own = answer(w, tester(1), OWN_WORDS);
    const exact = answer(w, tester(2), EXACT_WORDS);
    const r1 = await onFakeClock(() => runDeputyOnSubmission(own, deps));
    const r2 = await onFakeClock(() => runDeputyOnSubmission(exact, deps));
    expect(r1.value.action).not.toBe("settled");
    expect(r2.value.action).not.toBe("settled");
    expect(w.calls.requestPayout).toBe(0);
    expect(getSubmission(own)!.status).toBe("pending");
    expect(getSubmission(exact)!.status).toBe("pending");
    // the recorded decision is the heuristic's abstain: never an LLM verdict
    expect(getDecisionBySubmission(own)!.engine).toBe("heuristic");
    expect(getDecisionBySubmission(exact)!.engine).toBe("heuristic");
    // the matcher did clear the exact-words answer: what holds it is the builder's release, and only that
    expect(observationFromRow(getDecisionBySubmission(exact))!.barPass).toBe(true);
    // a sweep later changes nothing
    expect((await onFakeClock(() => runDeputyOnSubmission(exact, deps))).value.action).not.toBe("settled");
    expect(w.calls.requestPayout).toBe(0);

    // THE HOLD, as the builder meets it: both answers, and Sage never leans them to "no" for words it could not read
    const held = listHeldSubmissions(getCampaign(w.campaignId)!);
    expect(held.map((h) => h.submissionId).sort()).toEqual([own, exact].sort());
    const ownTriage = buildHeldTriage(getCampaign(w.campaignId)!, getSubmission(own)!);
    expect(ownTriage.lean).toBe("you-decide");
    expect(ownTriage.heldBecause[0]).toContain("Sage's model was not available to read this answer");
    expect(observationFromRow(getDecisionBySubmission(own))!.judgeAway).toBe(true);
    expect(buildHeldTriage(getCampaign(w.campaignId)!, getSubmission(exact)!).lean).toBe("pay");
    const waiting = liveView(getCampaign(w.campaignId)!, FOUNDER);
    expect(waiting.owner!.held).toBe(2);
    expect(waiting.tickets.every((t) => t.state === "checking")).toBe(true);

    // THE BUILDER RELEASES one: the vault pays the mission's exact reward, with the same settle path as ever
    const released = await onFakeClock(() => releaseSubmission(w.campaignId, own, { settle: (c, s) => settleByRail(c, s, deps) }));
    expect(released.value.ok).toBe(true);
    expect(released.value.settled, released.value.reason ?? "").toBe(true);
    expect(w.calls.requestPayout).toBe(1);
    expect(getSubmission(own)!.status).toBe("paid");
    expect(released.value.amountBase).toBe(w.fixture.mission.rewardAmount);
    expect(getSubmission(exact)!.status).toBe("pending");

    // THE FINDINGS, built plainly: the tester's own words, exact
    const findings = findingsView(getCampaign(w.campaignId)!, "owner", false);
    expect(findings.engine).toBe("plain");
    expect(findings.paid.answers).toBe(1);
    expect(findings.checking).toBe(1);
    const quotes = findings.findings.flatMap((f) => f.quotes.map((q) => q.text));
    expect(quotes.length).toBeGreaterThan(0);
    for (const q of quotes) expect(OWN_WORDS).toContain(q);

    // FIRST USERS: drafts written by code, on the builder's page
    const after = liveView(getCampaign(w.campaignId)!, FOUNDER);
    expect(after.owner!.users).toBeTruthy();
    expect(after.owner!.users!.engine).toBe("plain");
    expect(after.owner!.users!.productUrl).toBe(DROPS);
    expect(after.tickets.find((t) => t.key === own)!.state).toBe("paid");

    // and through all of it no model said a word
    if (mode === "no_model_configured") expect(out.zoo.calls).toHaveLength(0);
    expect(out.judgeAsks.length).toBeLessThanOrEqual(mode === "no_model_configured" ? 0 : 4);
  }, 120_000);

  it("empty_account: a kind people try (a Telegram bot)", async () => {
    arm("empty_account");
    process.env.OBSERVATION_AUTOPAY = "1";
    outside("empty_account");
    const w = await pasteToLive(BOT, false);
    const deps = { campaignAdapter: w.adapter, operatorAddress: () => V2_OPERATOR };
    const campaign = () => getCampaign(w.campaignId)!;

    // both lines of honesty: what Sage could not try, and that it designed this without its model
    const job = getInspectionJob(w.jobId)!;
    const map = (job.result as { map: { limitations: string[] } }).map;
    expect(map.limitations[0]).toBe(KIND_PLAYBOOK.telegram_bot.honesty);
    expect(liveView(campaign(), FOUNDER).withoutModel).toEqual({ line: NO_MODEL_BUILDER_LINE });
    expect(liveView(campaign(), FOUNDER).sageReads).toBe(KIND_PLAYBOOK.telegram_bot.firstTry!.place);

    const sub = answer(w, tester(3), "I took it for a bot that tells you what a coin costs, for people who trade from their phone. I opened it in Telegram, pressed the start button, typed the price command with a ticker and got a number back within a second. Nothing stopped me. I would use it again if it could alert me.");
    expect((await onFakeClock(() => runDeputyOnSubmission(sub, deps))).value.action).not.toBe("settled");
    expect(w.calls.requestPayout).toBe(0);
    expect(listHeldSubmissions(campaign())).toHaveLength(1);

    const released = await onFakeClock(() => releaseSubmission(w.campaignId, sub, { settle: (c, s) => settleByRail(c, s, deps) }));
    expect(released.value.settled, released.value.reason ?? "").toBe(true);
    expect(getSubmission(sub)!.status).toBe("paid");
    const findings = findingsView(campaign(), "owner", false);
    expect(findings.engine).toBe("plain");
    expect(findings.paid.answers).toBe(1);
    expect(findings.sageTried).toBeTruthy();
  }, 120_000);
});

/* ──────────────── 3. a test Sage pays alone, when the credit runs out mid-test ── */

describe("a live test that pays alone, when the model goes away", () => {
  it("holds an honest answer for the builder instead of coaching the tester to rewrite it, and asks again when the model is back", async () => {
    arm("empty_account");
    process.env.OBSERVATION_AUTOPAY = "1";
    const out = outside("empty_account", (c) => (isJudge(c) ? { obsConfidence: 0.2, corroborations: [], contradictions: [] } : {}));
    const w = await pasteToLive(DROPS, true);
    // the builder handed payouts back to Sage (their own act, after launch)
    updateCampaignAutonomy(w.campaignId, { autonomy: "autopilot", autopilotThreshold: 0.85 });
    expect(liveView(getCampaign(w.campaignId)!, FOUNDER).withoutModel).toBeNull();
    const deps = { campaignAdapter: w.adapter, operatorAddress: () => V2_OPERATOR };

    // THE CONTROL, and why a plan written with no model starts with the builder releasing: on a test that pays
    // alone, the deterministic matcher pays an answer in the product's exact words with no model at all.
    const ctl = answer(w, tester(9), EXACT_WORDS);
    expect((await onFakeClock(() => runDeputyOnSubmission(ctl, deps))).value.action).toBe("settled");
    expect(w.calls.requestPayout).toBe(1);
    const sub = answer(w, tester(4), OWN_WORDS);
    const first = await onFakeClock(() => runDeputyOnSubmission(sub, deps));
    // a FINAL hold for the builder: not "refine your answer, attempt 1 of 3" for words nobody read
    expect(first.value.action).toBe("held");
    expect(first.value.reason).toBe("observation_review");
    expect(decodeDetail(getLatestSubmissionEvent(sub, "autopay_held")!.detail).text).toContain(JUDGE_AWAY_LINE);
    expect(observationFromRow(getDecisionBySubmission(sub))!.judgeAway).toBe(true);
    expect(w.calls.requestPayout).toBe(1);
    const asksWhileAway = out.judgeAsks.length;

    // the next sweep, still with no credit: nothing changes, nothing is paid, nobody is told twice
    await onFakeClock(() => runDeputyOnSubmission(sub, deps));
    expect(getSubmission(sub)!.status).toBe("pending");

    // THE CREDIT IS BACK: the same answer is read by the model at last (the zeros were never kept as a verdict)
    for (const h of HOSTS) out.zoo.set(h, "healthy");
    resetWireMemory();
    await vi.advanceTimersByTimeAsync(120_000);
    await onFakeClock(() => runDeputyOnSubmission(sub, deps));
    expect(out.judgeAsks.length).toBeGreaterThan(asksWhileAway);
    expect(observationFromRow(getDecisionBySubmission(sub))!.judgeAway).toBeUndefined();
    // ...and a real verdict is stored once and not bought again
    const asksOnce = out.judgeAsks.length;
    await onFakeClock(() => runDeputyOnSubmission(sub, deps));
    expect(out.judgeAsks.length).toBe(asksOnce);
  }, 120_000);
});

/* ─────────────────────────────────────────────── 4. the chat, with no model ── */

describe("the concierge with no model", () => {
  it("says why in plain words and hands over to the web, never silence and never an error's text", () => {
    for (const why of ["not_configured", "out_of_credit", "not_answering"] as const) {
      const reply = noModelReply("telegram", why);
      expect(reply).toMatch(/^I can't chat right now: the model I think with is /);
      expect(reply).toContain("Test a product: paste its link at ");
      expect(reply).toContain("/earn");
      expect(reply).toContain("/status and /help still work here.");
      expect(reply).not.toMatch(/llm_|status_|429|402|Error|undefined/);
    }
    expect(noModelReply("web", "out_of_credit")).not.toContain("/status");
  });
});
