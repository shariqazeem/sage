// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * EVERY KIND OF PRODUCT, THROUGH THE REAL PIPELINE, OFFLINE (22 Nov 2026).
 *
 * One row per kind of product a builder can paste. Each row enters through `inspectAndPlan`, the function the
 * inspection job runs, and everything in between is production's own code: the bounded inspector, the HTML
 * extractor, the product map and its kind, the mission brain with its critic, the gate, the first-try mission,
 * the frozen allocator and the plan compiler.
 *
 * Only the outside world is substituted:
 *  - PAGES are saved HTML in ./pages, served by a fetch stub (any other address fails the test). They are small
 *    pages written in the shape of the real ones (their titles, their tags: Telegram's page has no headings,
 *    a Discord invite is blank until its scripts run), not captures of someone's product;
 *  - the BROWSER run, where a row has one, is a recorded summary handed to the pipeline;
 *  - the MODEL is the zoo (zoo.ts): each row injects the architect's answer, good missions and bad ones.
 *
 * Each row asserts: the kind detected; the first-try mission's words; that no mission in the plan asks for
 * something Sage cannot check; the honesty line on the map and in the first look; that every mission passes
 * the gate with every anchor found in what Sage read; and that the money is the allocator's, exactly.
 */
const hoisted = vi.hoisted(() => ({
  fieldTest: null as unknown,
  inspections: [] as { args: unknown[]; result: unknown }[],
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
      hoisted.inspections.push({ args, result });
      return result;
    },
  };
});

import { onFakeClock, Zoo, type Behaviour, type ZooCall } from "./zoo";
import { CORE_MISSION_KEY } from "@/lib/core-test/shape";
import { plainLookFor } from "@/lib/first-look";
import { CORE_DECISION_SYSTEM } from "@/lib/launch/core-decision";
import { detectUnsupportedEvidence } from "@/lib/launch/evidence-capabilities";
import type { InspectResult } from "@/lib/launch/inspect";
import { FIXED_WORDS_MODEL } from "@/lib/launch/mission-brain";
import { ARCHITECT_SYSTEM, CRITIC_SYSTEM, MISSION_PROMPT_VERSION } from "@/lib/launch/mission-prompt";
import { inspectAndPlan } from "@/lib/launch/pipeline";
import { KIND_PLAYBOOK, kindOfMap, kindProofIssue, type ProductKind } from "@/lib/launch/product-kind";
import { scopeFromObservations } from "@/lib/launch/product-map";
import type { CandidateMission, FieldTestSummary } from "@/lib/launch/schemas";
import { anchorIssues, buildObservationCorpus, classifyVerifiability, validatePlanMissions } from "@/lib/launch/validate-mission";
import { resetModelHealth } from "@/lib/llm/model-health";
import { resetWireMemory } from "@/lib/llm/wire";
import { factsOf } from "@/lib/test-page/before";

const MISSION_HOST = "mission.zoo.test";
const SHARED_HOST = "shared.zoo.test";
const FALLBACK_HOST = "fallback.zoo.test";
const FAST = "openai/gpt-5.4-mini-2026-03-17";
const ENV: Record<string, string> = {
  LLM_API_KEY: "k-shared", LLM_BASE_URL: `https://${SHARED_HOST}/v1`, LLM_MODEL: FAST,
  LLM_FALLBACK_API_KEY: "k-fallback", LLM_FALLBACK_BASE_URL: `https://${FALLBACK_HOST}/v1`, LLM_FALLBACK_MODEL: FAST,
  MISSION_API_KEY: "k-mission", MISSION_BASE_URL: `https://${MISSION_HOST}/v1`, MISSION_MODEL: FAST,
};
const CLEARED = ["COMMONSTACK_API_KEY", "COMMONSTACK_BASE_URL", "DEPUTY_MODEL", "LLM_TIMEOUT_MS", "LLM_DAILY_BUDGET_USD", "LLM_RETRY_MAX_WAIT_MS", "MISSION_GROUNDING_MODE", "MISSION_DESIGN_BUDGET_MS", "MISSION_HEDGE_AFTER_MS",
  "INSPECTION_REPLAY_MODE", "FIELD_TEST_ENABLED", "OBS_JUDGE_API_KEY", "OBS_JUDGE_BASE_URL", "OBS_JUDGE_MODEL", "DRAFT_API_KEY", "DRAFT_BASE_URL", "DRAFT_MODEL", "VISION_API_KEY", "VISION_BASE_URL", "VISION_MODEL"];
const saved: Record<string, string | undefined> = {};

const PAGES_DIR = path.join(process.cwd(), "tests", "model-zoo", "pages");
const pageHtml = (name: string): string => readFileSync(path.join(PAGES_DIR, `${name}.html`), "utf8");

const BUDGET = BigInt(10_000_000);

/* ───────────────────────────────────────────────────────────── fixtures ── */

const mission = (url: string, m: Pick<CandidateMission, "missionKey" | "title" | "objective" | "instructions" | "criteria" | "evidenceRequirements" | "anchors"> & Partial<CandidateMission>): CandidateMission => ({
  targetSurface: url,
  whyItMatters: "It is the thing this product says it does.",
  sources: [{ kind: "page", ref: url, observation: "read on the product's own page" }],
  priority: "high", riskCategory: "critical_journey", effortMinutes: 8, conditions: [], rewardWeight: 5, maxCompletions: 3,
  verificationMethod: "Sage judges the tester's own account against what it read and saw itself.", confidence: 0.8, assumptions: [], disallowed: [],
  ...m,
});

const browserRun = (url: string, over: Partial<FieldTestSummary>): FieldTestSummary =>
  ({ ran: true, startUrl: url, mode: "interactive", pages: [], states: [], classification: null, limitation: null, durationMs: 30_000, ...over }) as FieldTestSummary;
const pageSeen = (url: string, title: string, h1: string, ctas: string[], text: string) => ({ url, title, h1, ctas, forms: [], consoleErrors: [], brokenRequests: [], jsOnly: false, screenshot: null, visibleTextExcerpt: text });
const state = (url: string, trigger: string, text: string, buttons: string[]) => ({ trigger, screenshot: null, visibleTextExcerpt: text, notableElements: buttons.map((b) => ({ tag: "button", text: b, role: "button" })), pixelDeltaPct: 60, url });

interface CoreAnswer { mainAction: string; startsAt: string; rank: string; purpose: string; why: string }
const core = (mainAction: string, startsAt = ""): CoreAnswer => ({ mainAction, startsAt, rank: "lead", purpose: "You most likely want to know whether strangers get what this is and can try it.", why: "You asked whether people get it." });

interface Row {
  name: string;
  url: string;
  kind: ProductKind;
  /** address → saved page; anything else answers 404 */
  pages: Record<string, string>;
  browser?: FieldTestSummary;
  /** what the architect says; absent when the row expects it never to be asked */
  missions?: CandidateMission[];
  core: CoreAnswer;
  /** set a provider behaviour for the row (the small questions' chain) */
  shared?: Behaviour;
  /** the product's name as the mission says it */
  product: string;
  /** substrings of the first-try mission's instructions */
  firstTry: string[];
  /** keys that must ship, besides the first try */
  kept: string[];
  /** key → why the gate refused it */
  refused: Record<string, RegExp>;
  /** true when the architect must not be asked at all */
  architectSilent?: boolean;
}

const APP = "https://apps.apple.com/us/app/tidepool-habits/id1234567890";
const REPO = "https://github.com/acme/quickqueue";
const API = "https://api.weathergrid.dev/";
const FERN = "https://askfern.ai/";
const VAULT = "https://app.hummusvault.xyz/";
const PLOT = "https://plotline-planner.vercel.app/";
const DROPS = "https://getdrops.app/";
const NOTCH = "https://notchnotes.app/";

const ROWS: Row[] = [
  {
    name: "a Telegram bot",
    url: "https://t.me/pricewatch_bot",
    kind: "telegram_bot",
    pages: { "https://t.me/pricewatch_bot": "telegram-bot" },
    core: core("use /price to check a token's price", "Start Bot"),
    product: "@pricewatch_bot",
    firstTry: ["read the bot's name and description. Do not start it yet.", "Now open @pricewatch_bot in Telegram, press Start, and try to use /price to check a token's price.", "If it asks for money, your phone number, or a wallet, stop there"],
    kept: [],
    refused: {},
    architectSilent: true,
  },
  {
    name: "a Telegram mini app, with a model that names a forbidden action",
    url: "https://t.me/tapgarden_bot/play",
    kind: "telegram_mini_app",
    pages: { "https://t.me/tapgarden_bot/play": "telegram-mini-app" },
    // a transfer is never a first try, whatever a model says: the kind's own default stands
    core: core("transfer your tokens into the garden"),
    product: "@tapgarden_bot",
    firstTry: ["Now open @tapgarden_bot in Telegram, open its app, and try to open the app and do the first thing it offers."],
    kept: [],
    refused: {},
    architectSilent: true,
  },
  {
    name: "a Discord bot, with every model down",
    url: "https://top.gg/bot/771234567890123456",
    kind: "discord_bot",
    pages: { "https://top.gg/bot/771234567890123456": "discord-bot" },
    core: core("run a trivia round"),
    shared: "always_500",
    product: "Quizzy",
    firstTry: ["Now add Quizzy to a Discord server you own (a new, empty one is fine) and try to add it to a test server and run its main command."],
    kept: [],
    refused: {},
    architectSilent: true,
  },
  {
    name: "a Discord server",
    url: "https://discord.gg/metisbuilders",
    kind: "community",
    pages: { "https://discord.gg/metisbuilders": "community" },
    core: core("join and find the channel for newcomers"),
    product: "Metis Builders",
    firstTry: ["read the name and description. Do not join yet.", "Now try to join and find the channel for newcomers."],
    kept: [],
    refused: {},
    architectSilent: true,
  },
  {
    name: "a GitHub repository",
    url: REPO,
    kind: "code_repo",
    pages: { [REPO]: "code-repo", [`${REPO}/issues`]: "code-repo-issues" },
    missions: [
      mission(REPO, {
        missionKey: "run-the-quickstart",
        title: "Run the quickstart's hello example",
        objective: "Follow the Quickstart on your own computer and report what the hello example printed.",
        instructions: "1. Open https://github.com/acme/quickqueue and read the Quickstart.\n2. On your own computer, install it and run node examples/hello.js.\n3. Report what your terminal printed.",
        criteria: ["The answer says what the terminal printed after the hello example ran, or the first line of the error if it did not.", "The answer names the step of the Quickstart where the tester stopped, if they stopped."],
        evidenceRequirements: ["What did your terminal print after you ran the hello example?", "If you stopped before that, which step of the Quickstart stopped you, and why?"],
        anchors: ["Quickstart", "run node examples/hello.js"],
      }),
      mission(REPO, {
        missionKey: "share-it-in-discord",
        title: "Post the output in our Discord",
        objective: "Run the hello example and post what it printed in the project's Discord.",
        instructions: "1. Run node examples/hello.js.\n2. Post what it printed in the Discord.",
        criteria: ["The answer says what the hello example printed."],
        evidenceRequirements: ["Paste the link to your Discord message with the output."],
        anchors: ["Quickstart"],
      }),
      mission(REPO, {
        missionKey: "record-the-terminal",
        title: "Record the retry behaviour",
        objective: "Make a job throw and capture how it is retried.",
        instructions: "1. Make a job throw.\n2. Watch it being retried.",
        criteria: ["The answer says how many times the job was retried."],
        evidenceRequirements: ["Upload a screen recording of your terminal while the job is retried."],
        anchors: ["retried three times"],
      }),
    ],
    core: core("follow the quickstart and run the hello example", "Quickstart"),
    product: "quickqueue",
    firstTry: ["read the README for about a minute. Do not install anything yet.", "Now, on your own computer, try to follow the quickstart and run the hello example, using only what the README tells you, without administrator rights and without any real key or password of yours.", "note the last command you ran and the first line of what it printed"],
    kept: ["run-the-quickstart"],
    refused: { "share-it-in-discord": /a chat is not a page/, "record-the-terminal": /screen recording/ },
  },
  {
    name: "a package on PyPI",
    url: "https://pypi.org/project/tinytable/",
    kind: "package",
    pages: { "https://pypi.org/project/tinytable/": "package" },
    core: core("install it and print a sample table"),
    product: "tinytable",
    firstTry: ["read its description and README for about a minute. Do not install anything yet.", "Now, on your own computer, try to install it and print a sample table, using only what the page tells you, and without any real key or password of yours."],
    kept: [],
    refused: {},
  },
  {
    name: "an API with a key",
    url: API,
    kind: "api",
    pages: { [API]: "api", [`${API}docs`]: "api-docs" },
    missions: [
      mission(`${API}docs`, {
        missionKey: "first-successful-call",
        title: "Make a first forecast call from the quickstart",
        objective: "Follow the Quickstart with a free key of your own and report what the first request answered.",
        instructions: "1. Open https://api.weathergrid.dev/docs and follow the Quickstart.\n2. Sign up for a free key with an email of your own.\n3. Send your first request and note what came back.",
        criteria: ["The answer says what status the first request answered with and what the reply listed.", "The answer names the step of the Quickstart that took longest and why."],
        evidenceRequirements: ["What status did your first request answer with, and what did the reply list?", "Which step of the Quickstart took you longest, and why?"],
        anchors: ["Sign up for a free API key", "A successful call answers 200"],
        conditions: ["Comfortable with a terminal"],
      }),
      mission(`${API}docs`, {
        missionKey: "key-in-the-answer",
        title: "Prove the call with your key",
        objective: "Make a first call and hand over the key so the call can be repeated.",
        instructions: "1. Follow the Quickstart.\n2. Make a first call.",
        criteria: ["The answer says what the first call answered."],
        evidenceRequirements: ["Include your API key in your answer so the call can be repeated."],
        anchors: ["Sign up for a free API key"],
      }),
    ],
    core: core("get a key and make a first forecast call", "Get your API key"),
    product: "api.weathergrid.dev",
    firstTry: ["with a key of your own if it gives you one free.", "If it asks for a card or for money before a first call, stop there"],
    kept: ["first-successful-call"],
    refused: { "key-in-the-answer": /hand over a key/ },
  },
  {
    name: "an App Store listing, read by the browser",
    url: APP,
    kind: "mobile_app",
    pages: { [APP]: "mobile-app" },
    browser: browserRun(APP, {
      mode: "static",
      pages: [pageSeen(APP, "Tidepool Habits App - App Store", "Tidepool Habits", ["Tidepool Labs"],
        "Tidepool Habits\nBuild one habit at a time\nTidepool helps you build one habit at a time. Pick a habit, set a daily reminder, and watch your streak grow as a rising tide.\nWhat's New\nVersion 2.3 adds a weekly review screen and fixes the reminder that fired twice.\nApp Privacy\nThe developer, Tidepool Labs, indicated that the app does not collect any data.\nRatings and Reviews\nSimple and calm. I finally kept a habit for a month.\nInformation\nSeller Tidepool Labs\nCategory Health and Fitness\nCompatibility Requires iOS 16 or later.\nLanguages English, Spanish and French")],
    }),
    missions: [
      mission(APP, {
        missionKey: "set-a-daily-reminder",
        title: "Set a daily reminder for one habit",
        objective: "Pick a habit in the app, set a daily reminder for it, and report what the app showed once it was set.",
        instructions: "1. Install Tidepool Habits on your own phone.\n2. Pick a habit and set a daily reminder for it.\n3. Note what the app showed once the reminder was set.",
        criteria: ["The answer says which habit the tester picked and what the app showed once the reminder was set.", "The answer says what the tester expected to happen next and whether it did."],
        evidenceRequirements: ["Which habit did you pick, and what did the app show once the reminder was set?", "What did you expect to happen next, and did it?"],
        anchors: ["set a daily reminder", "watch your streak grow"],
      }),
      mission(APP, {
        missionKey: "quote-whats-new",
        title: "Find what changed in the latest version",
        objective: "Open the listing and report what the latest version changed.",
        instructions: "1. Open https://apps.apple.com/us/app/tidepool-habits/id1234567890.\n2. Scroll to What's New.",
        criteria: ["The tester reaches the page titled Tidepool Habits and quotes the text under the What's New heading."],
        evidenceRequirements: ["What text is shown under the What's New heading on the reached page?"],
        anchors: ["What's New", "weekly review screen"],
      }),
    ],
    core: core("pick a habit and set a daily reminder"),
    product: "Tidepool Habits",
    firstTry: ["read the listing for about a minute. Do not install anything yet.", "Now install Tidepool Habits on your own phone and try to pick a habit and set a daily reminder.", "If your phone warns you about the app, or it asks for money, a card, or an account you do not want to make, stop there"],
    kept: ["set-a-daily-reminder"],
    refused: { "quote-whats-new": /pays for reading it/ },
  },
  {
    name: "a browser extension",
    url: "https://chromewebstore.google.com/detail/tabtidy/abcdefghijklmnopabcdefghijklmnop",
    kind: "browser_extension",
    pages: { "https://chromewebstore.google.com/detail/tabtidy/abcdefghijklmnopabcdefghijklmnop": "browser-extension" },
    core: core("open it and group your tabs by site"),
    product: "TabTidy",
    firstTry: ["including what it asks permission for. Do not install anything yet.", "Now install TabTidy in your own browser and try to open it and group your tabs by site."],
    kept: [],
    refused: {},
  },
  {
    name: "a desktop download, with an architect that has nothing to design",
    url: NOTCH,
    kind: "desktop_app",
    pages: { [NOTCH]: "desktop-app", [`${NOTCH}changelog`]: "desktop-app-changelog" },
    missions: [],
    core: core("open it and save a first note"),
    product: "NotchNotes",
    firstTry: ["read the page for about a minute. Do not download anything yet.", "Now download and install NotchNotes on your own computer and try to open it and save a first note.", "If your computer warns that it cannot check the app"],
    kept: [],
    refused: {},
  },
  {
    name: "a waitlist page",
    url: "https://orbitmail.xyz/",
    kind: "waitlist",
    pages: { "https://orbitmail.xyz/": "waitlist" },
    core: core("decide whether to join the waitlist"),
    product: "Orbitmail: email that sorts itself",
    firstTry: ["look at it for about ten seconds without scrolling.", "Now read the rest of the page and try to decide whether to join the waitlist. Joining is your choice: nobody is asked to give an email."],
    kept: [],
    refused: {},
    architectSilent: true,
  },
  {
    name: "an AI chat product",
    url: FERN,
    kind: "ai_chat",
    pages: { [FERN]: "ai-chat" },
    browser: browserRun(FERN, {
      pages: [pageSeen(FERN, "Fern: ask your tax questions", "How can I help with your taxes today?", ["Pricing", "Log in", "Send"], "How can I help with your taxes today?\nFern answers questions about freelance taxes in plain words, and shows the rule each answer comes from.\nAsk anything about freelance taxes\nSend")],
      states: [
        state(FERN, "initial load", "How can I help with your taxes today?\nAsk anything about freelance taxes\nSend", ["Ask anything about freelance taxes", "Send"]),
        state(FERN, "typed the test message", "Fern is not a tax adviser. Check anything important with a professional.\nThe rule this comes from", ["Send", "New question"]),
      ],
    }),
    missions: [
      mission(FERN, {
        missionKey: "ask-about-a-deduction",
        title: "Ask about one deduction and check the rule it cites",
        objective: "Ask Fern whether one real expense of yours can be deducted and report the rule it said the reply came from.",
        instructions: "1. Open https://askfern.ai/.\n2. Type a question about one real expense and press Send.\n3. Note which rule the reply said it came from.",
        criteria: ["The answer says what the tester asked and which rule Fern said the reply came from.", "The answer says one thing in the reply that was right or wrong for the tester's own case."],
        evidenceRequirements: ["What did you ask, and which rule did Fern say its reply came from?", "What was one thing in the reply that was right or wrong for your own case?"],
        anchors: ["Ask anything about freelance taxes", "shows the rule each answer comes from"],
      }),
    ],
    core: core("ask a question about freelance taxes", "Ask anything about freelance taxes"),
    product: "Fern: ask your tax questions",
    firstTry: ["look at the first screen for about ten seconds. Do not type anything yet.", "Now try to ask a question about freelance taxes, starting from “Ask anything about freelance taxes”, then ask one follow-up."],
    kept: ["ask-about-a-deduction"],
    refused: {},
  },
  {
    // "Checkout flow for the first time" reads to the gate as a purchase: the mission is written with a plain noun
    name: "a Figma prototype whose own name trips the gate",
    url: "https://www.figma.com/proto/AbC123/Checkout-flow",
    kind: "design_prototype",
    pages: { "https://www.figma.com/proto/AbC123/Checkout-flow": "design-prototype" },
    core: core("click through the checkout from the cart to the last screen"),
    product: "this prototype",
    firstTry: ["look at the first screen for about ten seconds. Do not click anything yet.", "Click where you would expect a real product to respond.", "If nothing responds where you click, that counts as where you stopped."],
    kept: [],
    refused: {},
    architectSilent: true,
  },
  {
    name: "a recorded demo",
    url: "https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184",
    kind: "video_demo",
    pages: { "https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184": "video-demo" },
    core: core("watch the demo to the end"),
    product: "Plotline demo",
    firstTry: ["read its title and description. Do not press play yet.", "Now try to watch the demo to the end, at normal speed."],
    kept: [],
    refused: {},
    architectSilent: true,
  },
  {
    name: "a Metis dapp behind Connect wallet",
    url: VAULT,
    kind: "wallet_dapp",
    pages: { [VAULT]: "wallet-dapp", [`${VAULT}docs`]: "wallet-dapp-docs" },
    browser: browserRun(VAULT, {
      limitation: "connect-wallet required past this point",
      pages: [pageSeen(VAULT, "Hummus Vault: earn on Metis", "Earn on your idle m.USDC", ["Docs", "Connect Wallet"], "Earn on your idle m.USDC\nVaults\nStable Vault holds m.USDC. Blue Chip Vault holds METIS and WETH.\nConnect your wallet to view your positions.")],
      states: [
        state(VAULT, "initial load", "Earn on your idle m.USDC\nConnect Wallet\nVaults\nStable Vault\nBlue Chip Vault", ["Connect Wallet", "Docs"]),
        state(VAULT, 'clicked "Connect Wallet"', "Connect a wallet\nMetaMask\nWalletConnect\nRabby", ["MetaMask", "WalletConnect", "Rabby"]),
      ],
      docs: [{ url: `${VAULT}docs`, title: "Docs | Hummus Vault", excerpt: "After you connect, the Positions page lists each vault you are in and what it earned.", soughtBecause: "connect-wallet required past this point" }],
    }),
    missions: [
      mission(VAULT, {
        missionKey: "find-your-positions",
        title: "Connect a wallet and find the Positions page",
        objective: "Connect a wallet you already use and report what the Positions page lists.",
        instructions: "1. Open https://app.hummusvault.xyz/ and press Connect Wallet.\n2. Connect a wallet you already use. Confirm nothing else.\n3. Find the Positions page and note what it lists.",
        criteria: ["The answer says what the Positions page listed once the wallet was connected.", "The answer names the wallets offered after Connect Wallet was pressed."],
        evidenceRequirements: ["What did the Positions page list once your wallet was connected?", "Which wallets were offered after you pressed Connect Wallet?"],
        anchors: ["Connect Wallet", "Positions page lists each vault"],
        conditions: ["A wallet you already use"],
      }),
      mission(VAULT, {
        missionKey: "prove-it-on-chain",
        title: "Preview a vault and prove it",
        objective: "Open the Stable Vault page and report what the Preview button showed.",
        instructions: "1. Open the Stable Vault page.\n2. Press Preview.",
        criteria: ["The answer says what the Preview button showed."],
        evidenceRequirements: ["What is the transaction hash shown once you confirmed?"],
        anchors: ["Stable Vault"],
      }),
    ],
    // a swap is never a first try: the action is then read from the mission the gate accepted
    core: core("swap m.USDC into the Stable Vault", "Connect Wallet"),
    product: "Hummus Vault: earn on Metis",
    firstTry: ["look at the first screen for about ten seconds. Do not connect anything yet.", "Now try to connect a wallet and find the Positions page, starting from “Connect Wallet”.", "Use a wallet with nothing in it you would mind losing (a new, empty one is best), and never type a recovery phrase or a private key anywhere.", "Stop at the first request to confirm anything in your wallet, or to add funds: that counts as where you stopped."],
    kept: ["find-your-positions"],
    refused: { "prove-it-on-chain": /transaction's hash/ },
  },
  {
    name: "a single-page app on an app builder's host",
    url: PLOT,
    kind: "single_page_app",
    pages: { [PLOT]: "single-page-app" },
    browser: browserRun(PLOT, {
      pages: [{ ...pageSeen(PLOT, "Plotline", "Plan your week of dinners", ["Start planning"], "Plan your week of dinners\nPick three dinners and get one shopping list.\nStart planning"), jsOnly: true }],
      states: [
        state(PLOT, "initial load", "Plan your week of dinners\nPick three dinners and get one shopping list.\nStart planning", ["Start planning"]),
        state(PLOT, 'clicked "Start planning"', "Pick three dinners\nPasta night\nTaco night\nCurry night\nContinue", ["Pasta night", "Taco night", "Curry night", "Continue"]),
        state(PLOT, 'clicked "Continue"', "Your shopping list\n12 things to get\nSend to my phone", ["Send to my phone"]),
      ],
    }),
    missions: [
      mission(PLOT, {
        missionKey: "plan-three-dinners",
        title: "Pick three dinners and reach the shopping list",
        objective: "Pick three dinners and report what the shopping list screen showed.",
        instructions: "1. Open https://plotline-planner.vercel.app/ and click Start planning.\n2. Select three dinners and click Continue.\n3. Note what the next screen showed.",
        criteria: ["After you click Continue, the next screen is headed Your shopping list.", "The answer names the button under the shopping list."],
        evidenceRequirements: ["What was the screen after Continue headed?", "What were the words on the button under the list?"],
        anchors: ["Start planning", "Pick three dinners", "Your shopping list"],
      }),
    ],
    core: core("plan a week of dinners"),
    product: "Plotline",
    // tried in the browser like any site: the first-try mission is the unchanged one
    firstTry: ["look at the first screen for about ten seconds. Do not click anything yet.", "Now try to plan a week of dinners. Go as far as you can. If it asks for money, a wallet approval or an account you do not want to make, stop there"],
    kept: ["plan-three-dinners"],
    refused: {},
  },
  {
    name: "an ordinary website (the control: nothing changes)",
    url: DROPS,
    kind: "website",
    pages: { [DROPS]: "website", [`${DROPS}new`]: "website-new" },
    missions: [
      mission(DROPS, {
        missionKey: "start-a-drop",
        title: "Start a drop from the home page",
        objective: "Start a drop from the home page and report what the screen that follows asks for.",
        instructions: "1. Open https://getdrops.app/\n2. Click Start a drop.\n3. Report what the screen that follows asks you for.",
        criteria: ["After you click Start a drop, the next screen asks who the gift is for.", "The tester reports the words on the button at the bottom of that screen."],
        evidenceRequirements: ["What did the screen after Start a drop ask you for?", "What were the words on the button at the bottom?"],
        anchors: ["Start a drop", "Who is it for?"],
      }),
    ],
    core: core("start a drop", "Start a drop"),
    product: "Drops: send a gift to anyone",
    firstTry: ["look at the first screen for about ten seconds. Do not click anything yet.", "Now try to start a drop, starting from “Start a drop”."],
    kept: ["start-a-drop"],
    refused: {},
  },
];

/* ─────────────────────────────────────────────────────────── the harness ── */

interface Outside { zoo: Zoo; pageFetches: string[]; architectAsks: ZooCall[]; coreAsks: ZooCall[] }

function outsideWorld(row: Row): Outside {
  const architectAsks: ZooCall[] = [];
  const coreAsks: ZooCall[] = [];
  const pageFetches: string[] = [];
  const zoo = new Zoo((c) => {
    if (c.system === ARCHITECT_SYSTEM) {
      architectAsks.push(c);
      return { core: row.core, missions: row.missions ?? [] };
    }
    if (c.system === CRITIC_SYSTEM) return { critiques: [] };
    if (c.system === CORE_DECISION_SYSTEM) {
      coreAsks.push(c);
      return { core: row.core };
    }
    return {};
  });
  if (row.shared) zoo.set(SHARED_HOST, row.shared).set(FALLBACK_HOST, row.shared).set(MISSION_HOST, row.shared);
  const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const u = new URL(url);
    if (u.host.endsWith(".zoo.test")) return zoo.fetch(input, init);
    pageFetches.push(url);
    // the repository reader's two public calls and the files it then reads (github.ts)
    if (u.host === "api.github.com") {
      if (u.pathname === "/repos/acme/quickqueue") return json({ default_branch: "main" });
      if (u.pathname === "/repos/acme/quickqueue/git/trees/main") return json({ tree: [{ path: "README.md", type: "blob", size: 900 }, { path: "package.json", type: "blob", size: 300 }, { path: "docs/usage.md", type: "blob", size: 500 }, { path: "logo.png", type: "blob", size: 9000 }] });
      return json({ message: "Not Found" }, 404);
    }
    if (u.host === "raw.githubusercontent.com") {
      if (u.pathname.endsWith("/package.json")) return new Response(JSON.stringify({ name: "quickqueue", scripts: { test: "vitest" }, dependencies: { "better-sqlite3": "^11" } }));
      return new Response("# quickqueue\n\nA tiny job queue for Node, backed by SQLite.\n");
    }
    const name = row.pages[url.replace(/#.*$/, "")];
    return name ? html(pageHtml(name)) : html("<title>Not found</title>", 404);
  });
  return { zoo, pageFetches, architectAsks, coreAsks };
}

const MONEY_KEYS = ["rewardUsd", "amount", "payout", "totalBudget", "reward", "rewardBase"];
const table: string[] = [];

beforeEach(() => {
  for (const k of [...Object.keys(ENV), ...CLEARED]) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, ENV);
  hoisted.fieldTest = null;
  hoisted.inspections.length = 0;
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
  if (process.env.ZOO_TABLE) console.log(["kind | product | missions shipped | first try | architect asks | pages read", ...table].join("\n"));
});

describe("every kind of product through the real pipeline, offline", () => {
  it("has a row for every kind", () => {
    const covered = new Set(ROWS.map((r) => r.kind));
    for (const k of Object.keys(KIND_PLAYBOOK)) expect(covered.has(k as ProductKind), `no fixture for ${k}`).toBe(true);
  });

  it.each(ROWS)("$name", async (row) => {
    hoisted.fieldTest = row.browser ?? null;
    const out = outsideWorld(row);
    const book = KIND_PLAYBOOK[row.kind];
    const { value: r } = await onFakeClock(() =>
      inspectAndPlan({ productUrl: row.url, goal: "see whether strangers get it and can try it", targetUsers: "", totalBudgetBase: BUDGET, tokenDecimals: 6 }, `kinds-${row.kind}`, () => {}, 1, row.browser ? { inspectionId: `kinds-${row.kind}` } : {}),
    );

    // a plan, for every kind: never a question the builder cannot answer
    expect(r.stage, `${r.reason} ${JSON.stringify(r.questions)} ${JSON.stringify(r.brain?.reports?.filter((x) => !x.ok))}`).toBe("ready");
    const map = r.map!;
    const accepted = r.brain!.accepted;
    const plan = r.plan!;

    // 1. THE KIND, detected with no model, beside the category
    expect(kindOfMap(map)).toBe(row.kind);
    if (row.kind === "website") expect(map.productKind).toBeUndefined();
    else expect(map.productKind!.because.length).toBeGreaterThan(10);
    expect(map.category).toBeTruthy();
    // 1b. THE SAFETY SCREEN ran on what Sage read, found nothing, and no model was told about it
    expect(map.safety).toMatchObject({ outcome: "clear", signals: [] });
    for (const ask of out.architectAsks) expect(ask.user).not.toContain('"safety"');

    // 2. THE FIRST TRY, in the kind's own fixed words, naming the product (never the platform it is listed on)
    const first = accepted.find((m) => m.missionKey === CORE_MISSION_KEY)!;
    expect(first, "the first-try mission").toBeTruthy();
    expect(first.title).toBe(`Try ${row.product} for the first time and say how far you got`);
    for (const words of row.firstTry) expect(first.instructions).toContain(words);
    expect(first.instructions).toContain(`1. Open ${row.url} and `);
    expect(classifyVerifiability(first)).toBe("observation-based");
    if (book.firstTry) {
      expect(first.criteria[1]).toBe(`The answer names one specific thing from ${book.firstTry.place} that matches what Sage read there.`);
      expect(first.verificationMethod).toContain(book.honesty);
    } else {
      expect(first.verificationMethod).toContain("what it observed itself on the same screens");
    }

    // 3. NOTHING SAGE CANNOT CHECK ships, and what was refused says why
    expect(accepted.map((m) => m.missionKey).sort()).toEqual([CORE_MISSION_KEY, ...row.kept].sort());
    expect(plan.missions.map((m) => m.missionKey).sort()).toEqual([CORE_MISSION_KEY, ...row.kept].sort());
    for (const m of accepted) {
      expect(detectUnsupportedEvidence(m), m.missionKey).toBeNull();
      expect(kindProofIssue(m, row.kind, classifyVerifiability(m)), m.missionKey).toBeNull();
      // on a listing, every mission is the tester's own account: none is paid for quoting the listing
      if (book.listingOnly) expect(classifyVerifiability(m)).toBe("observation-based");
      for (const k of MONEY_KEYS) expect(m).not.toHaveProperty(k);
    }
    for (const [key, why] of Object.entries(row.refused)) {
      const report = r.brain!.reports.find((rep) => rep.missionKey === key);
      expect(report?.ok, key).toBe(false);
      expect(report!.issues.map((i) => i.detail).join(" | ")).toMatch(why);
    }

    // 4. THE HONESTY LINE: first among the limits on the map, in the first look, and on the builder's page
    if (book.honesty) {
      expect(map.limitations[0]).toBe(book.honesty);
      expect(plainLookFor(map, row.url).limits[0]).toBe(book.honesty);
      expect(factsOf(map, null).couldNotSee[0]).toBe(book.honesty);
      expect(factsOf(map, null).facts.find((f) => f.label === "What kind of product")!.value).toContain(book.label);
    } else {
      expect(factsOf(map, null).facts.some((f) => f.label === "What kind of product")).toBe(row.kind !== "website");
    }
    // where people do the try, Sage never claims it explored the product
    if (book.peopleDoTheTry) expect(map.limitations.join(" ")).not.toMatch(/explored the live product/);

    // 5. THE GATE passes for every mission, and every anchor is text Sage really read (anchor integrity 100%)
    const inspection = hoisted.inspections[0]!.result as InspectResult;
    const scope = scopeFromObservations(inspection.observations, [], map.fieldTest);
    const corpus = buildObservationCorpus(inspection.observations, map.fieldTest);
    expect(validatePlanMissions(accepted, scope, corpus, map.observations).every((rep) => rep.ok)).toBe(true);
    for (const m of accepted) {
      expect(m.anchors!.length, m.missionKey).toBeGreaterThan(0);
      expect(anchorIssues(m, corpus), m.missionKey).toEqual([]);
    }

    // 6. THE MONEY is the allocator's: exact in base units, inside the budget, and no model stated any of it
    const total = plan.missions.reduce((sum, m) => sum + m.rewardBase * m.maxCompletions, BigInt(0));
    expect(total).toBe(plan.allocatedBase);
    expect(plan.allocatedBase <= BUDGET && plan.allocatedBase > BigInt(0)).toBe(true);
    expect(plan.promptVersion).toBe(MISSION_PROMPT_VERSION);

    // 7. THE ARCHITECT is told the kind, in one trusted line, or is not needed at all
    if (row.architectSilent) {
      expect(out.architectAsks).toHaveLength(0);
      expect(r.brain!.model).toBe(FIXED_WORDS_MODEL);
    } else {
      expect(out.architectAsks.length).toBeGreaterThan(0);
      const told = out.architectAsks[0]!.user;
      if (row.kind === "website") expect(told).not.toContain("PRODUCT KIND");
      else {
        expect(told).toContain(`PRODUCT KIND (decided by Sage from the address and what it saw; trusted): ${book.architect}`);
        expect(told.indexOf("PRODUCT KIND")).toBeLessThan(told.indexOf("PRODUCT MAP (UNTRUSTED"));
        expect(told).toContain(`"productKind":{"kind":"${row.kind}"`);
      }
    }
    // the small question that names the main action is told the kind too
    for (const ask of out.coreAsks) expect(ask.user.includes("PRODUCT KIND")).toBe(row.kind !== "website");

    // 8. NO NETWORK but the saved pages, and on a shared platform only the product's own pages are read
    for (const fetched of out.pageFetches) {
      const u = new URL(fetched);
      expect(["api.github.com", "raw.githubusercontent.com", new URL(row.url).host]).toContain(u.host);
    }
    if (row.kind === "code_repo") {
      const onGithub = out.pageFetches.filter((f) => new URL(f).host === "github.com");
      expect(onGithub.length).toBeGreaterThan(1);
      for (const f of onGithub) expect(new URL(f).pathname.startsWith("/acme/quickqueue")).toBe(true);
      // the pasted repository is read as a repository (its README and file list), never run
      expect(map.repoFilesInspected).toBeGreaterThan(0);
    }

    table.push(`${row.kind} | ${row.product} | ${plan.missions.length} | ${first.instructions.split("\n")[2]!.slice(0, 90)} | ${out.architectAsks.length} | ${inspection.observations.length}`);
  }, 60_000);
});

/**
 * NEVER SEND A TESTER INTO HARM (src/lib/safety/). The same pipeline, on products it must not plan for as
 * usual: a refused product ends before any model is asked and leaves no plan to launch; a held one is
 * planned, with the hold on its map for the doors to read.
 */
describe("the product safety screen, in the pipeline", () => {
  const base = { kind: "wallet_dapp" as ProductKind, core: core("connect a wallet", "Connect Wallet"), product: "", firstTry: [], kept: [], refused: {} };
  const run = (row: Row, opts: Parameters<typeof inspectAndPlan>[4] = {}) =>
    onFakeClock(() => inspectAndPlan({ productUrl: row.url, goal: "see whether strangers get it and can try it", targetUsers: "", totalBudgetBase: BUDGET, tokenDecimals: 6 }, "safety-row", () => {}, 1, opts));

  it("REFUSED: a page with a recovery-phrase field ends the run with the plain reason, and no model is asked", async () => {
    const row: Row = { ...base, name: "seed form", url: "https://dapp-fix-portal.xyz/", pages: { "https://dapp-fix-portal.xyz/": "harm-seed-form" } };
    const out = outsideWorld(row);
    const { value: r } = await run(row);
    expect(r.stage).toBe("failed");
    expect(r.reason).toBe("Sage can't run a test here: the page has a field that asks for a recovery phrase. Sage does not send testers to an address like that. If this is a mistake, tell us and a person at Sage will look.");
    expect(r.plan).toBeNull();
    expect(r.brain).toBeNull();
    expect(r.map!.safety).toMatchObject({ outcome: "refused", subject: "dapp-fix-portal.xyz" });
    expect(out.zoo.calls).toHaveLength(0);
  });

  it("REFUSED: a lookalike of a well-known brand that asks for a wallet", async () => {
    const row: Row = { ...base, name: "lookalike", url: "https://app-uniswap-claim.xyz/", pages: { "https://app-uniswap-claim.xyz/": "harm-lookalike" } };
    const out = outsideWorld(row);
    const { value: r } = await run(row);
    expect(r.stage).toBe("failed");
    expect(r.reason).toContain("looks like Uniswap's name but is not one of Uniswap's addresses");
    expect(out.zoo.calls).toHaveLength(0);
  });

  it("HELD: drainer wording on a connect screen does not end the run; the hold rides on the map for the doors", async () => {
    const row: Row = { ...base, name: "drainer", url: "https://zkr-portal.xyz/", pages: { "https://zkr-portal.xyz/": "harm-drainer" } };
    outsideWorld(row);
    const { value: r } = await run(row);
    // the run goes on exactly as it would for any dapp: a hold never ends it
    expect(r.stage).not.toBe("failed");
    expect(r.map!.safety).toMatchObject({ outcome: "hold", signals: [{ id: "drainer_words", severity: "hold" }] });
  });

  it("the durable job's own screen is the one that decides, and a screen that throws falls back to what Sage saw", async () => {
    const row: Row = { ...base, name: "seed form", url: "https://dapp-fix-portal.xyz/", pages: { "https://dapp-fix-portal.xyz/": "harm-seed-form" } };
    outsideWorld(row);
    const asked: string[] = [];
    // a person at Sage cleared this product: the server's screen says clear, and the plan is written
    const { value: cleared } = await run(row, { screen: async (c) => { asked.push(c.url); return { version: 1, outcome: "clear", subject: "dapp-fix-portal.xyz", host: "dapp-fix-portal.xyz", hosts: ["dapp-fix-portal.xyz"], signals: [], lists: { phishing: "checked", safeBrowsing: "off", domainAge: "off" }, reviewed: { decision: "cleared", at: 5 }, checkedAt: 9 }; } });
    expect(asked).toEqual(["https://dapp-fix-portal.xyz/"]);
    expect(cleared.stage).not.toBe("failed");
    expect(cleared.map!.safety!.reviewed).toEqual({ decision: "cleared", at: 5 });
    const { value: thrown } = await run(row, { screen: async () => { throw new Error("the record could not be read"); } });
    expect(thrown.stage).toBe("failed");
    expect(thrown.map!.safety!.outcome).toBe("refused");
  });
});
