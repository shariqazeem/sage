// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SIX LISTINGS, AS THE LIVE BATTERY MET THEM (23 Nov 2026).
 *
 * P-GEN ran six real listings with almost no model credit, and the first-try mission came back naming the
 * platform ("Try T", "Try GitHub", "Try App Store") and anchored on its furniture ("Search", "Sign in", "Skip to
 * main content", "View all files", a bot check's "Client Challenge"). One row's anchors were not in the stored
 * map at all, which the battery reads as anchor integrity 0%: a hard stop.
 *
 * Each row here is an invented product on a page SHAPED like the real one: the platform's own titles, headings,
 * navigation and stock sentences around a product that does not exist. Sage's browser run is a recorded summary
 * of the same shape, including a picture reader that sees the platform's name on the screen (the thing that
 * renamed the products). Every row runs through `inspectAndPlan` twice: with an empty model account, and with a
 * healthy model that has nothing to design. Asserted on both:
 *  - the product's name, on the map and in the mission, never the platform's;
 *  - every anchor of the first try is the product's own words: not furniture, not a bot check;
 *  - every anchor is in the gate's corpus AND in the stored map, by the battery's own ruler (integrity 100%);
 *  - the kind's honesty line still leads the limits, and a bot check is said among them.
 */
const hoisted = vi.hoisted(() => ({ fieldTest: null as unknown, inspections: [] as { result: unknown }[] }));

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

import { onFakeClock, Zoo } from "./zoo";
import { CORE_MISSION_KEY } from "@/lib/core-test/shape";
import { plainLookFor } from "@/lib/first-look";
import { CORE_DECISION_SYSTEM } from "@/lib/launch/core-decision";
import type { InspectResult } from "@/lib/launch/inspect";
import { ARCHITECT_SYSTEM, CRITIC_SYSTEM } from "@/lib/launch/mission-prompt";
import { inspectAndPlan } from "@/lib/launch/pipeline";
import { isBotCheck, isPlatformChrome, KIND_PLAYBOOK, kindOfMap, type ProductKind } from "@/lib/launch/product-kind";
import type { FieldTestSummary, VisionObservation } from "@/lib/launch/schemas";
import { anchorIssues, buildObservationCorpus } from "@/lib/launch/validate-mission";
import { resetModelHealth } from "@/lib/llm/model-health";
import { resetWireMemory } from "@/lib/llm/wire";

const HOSTS = ["mission.zoo.test", "shared.zoo.test", "fallback.zoo.test"];
const FAST = "openai/gpt-5.4-mini-2026-03-17";
const ENV: Record<string, string> = {
  LLM_API_KEY: "k-shared", LLM_BASE_URL: "https://shared.zoo.test/v1", LLM_MODEL: FAST,
  LLM_FALLBACK_API_KEY: "k-fallback", LLM_FALLBACK_BASE_URL: "https://fallback.zoo.test/v1", LLM_FALLBACK_MODEL: FAST,
  MISSION_API_KEY: "k-mission", MISSION_BASE_URL: "https://mission.zoo.test/v1", MISSION_MODEL: FAST,
};
const CLEARED = ["COMMONSTACK_API_KEY", "COMMONSTACK_BASE_URL", "DEPUTY_MODEL", "LLM_TIMEOUT_MS", "LLM_DAILY_BUDGET_USD", "LLM_RETRY_MAX_WAIT_MS", "MISSION_GROUNDING_MODE", "MISSION_DESIGN_BUDGET_MS", "MISSION_HEDGE_AFTER_MS",
  "INSPECTION_REPLAY_MODE", "FIELD_TEST_ENABLED", "OBS_JUDGE_API_KEY", "OBS_JUDGE_BASE_URL", "OBS_JUDGE_MODEL", "DRAFT_API_KEY", "DRAFT_BASE_URL", "DRAFT_MODEL", "VISION_API_KEY", "VISION_BASE_URL", "VISION_MODEL"];
const saved: Record<string, string | undefined> = {};
const PAGES_DIR = path.join(process.cwd(), "tests", "model-zoo", "pages");
const pageHtml = (name: string): string => readFileSync(path.join(PAGES_DIR, `${name}.html`), "utf8");
const BUDGET = BigInt(10_000_000);

/* ────────────────────────────────────────────── what Sage's browser saw ── */

const state = (url: string, trigger: string, text: string, buttons: string[]) => ({ trigger, screenshot: null, visibleTextExcerpt: text, notableElements: buttons.map((b) => ({ tag: "a", text: b, role: "link" })), pixelDeltaPct: 60, url });
const pageSeen = (url: string, title: string, h1: string, ctas: string[], text: string) => ({ url, title, h1, ctas, forms: [], consoleErrors: [], brokenRequests: [], jsOnly: false, screenshot: null, visibleTextExcerpt: text });
/** The picture reader, reading the platform's own name off the screen: what renamed the products. */
const picture = (visibleText: string[]): VisionObservation => ({ stateIndex: 0, trigger: "initial load", sceneDescription: "A listing page on a large platform with a header, a search box and one product in the middle.", visibleText, uiElements: [], productTypeSignals: [], audienceSignals: [], qualityIssues: [] });
const run = (url: string, over: Partial<FieldTestSummary>): FieldTestSummary =>
  ({ ran: true, startUrl: url, mode: "interactive", pages: [], states: [], classification: null, limitation: null, durationMs: 30_000, ...over }) as FieldTestSummary;

const BOT = "https://t.me/ledgerlarkbot";
const REPO = "https://github.com/harborworks/tidewatch";
const PKG = "https://pypi.org/project/slatecsv/";
const APP = "https://apps.apple.com/us/app/lanternly-night-reader/id1234567891";
const EXT = "https://chromewebstore.google.com/detail/pagepebble/abcdefghijklmnopabcdefghijklmnoq";
const INVITE = "https://discord.com/invite/kilnclub";

/** GitHub's first screen: its own navigation and file list come long before the README. */
const REPO_SCREEN = [
  "Skip to content", "Navigation Menu", "Sign in", "Sign up", "harborworks", "/", "tidewatch", "Public", "Notifications", "Fork 12", "Star 340",
  "Code", "Issues", "Pull requests", "Actions", "Security", "Insights",
  "main", "Branches", "Tags", "Go to file", "Code", "Folders and files", "Name", "Last commit message", "Last commit date", "Latest commit", "History", "214 Commits",
  ...Array.from({ length: 30 }, (_, i) => `src/harbour_${i}.rs`),
  "View all files", "Repository files navigation", "README", "MIT license",
  "tidewatch",
  "Tide tables for any harbour, from the command line. One binary, no account, works offline once a harbour is cached.",
  "Quick tour",
  "Run tidewatch next brixham to print the next high and low water for Brixham in local time.",
  "About", "Tide tables for any harbour, from the command line", "Readme", "MIT license", "Activity", "340 stars", "9 watching", "12 forks", "Report repository", "Releases", "Packages", "Contributors", "Languages",
].join("\n");

interface Row {
  name: string;
  url: string;
  kind: ProductKind;
  pages: Record<string, string>;
  browser: FieldTestSummary;
  /** the product's name, on the map and in the mission */
  product: string;
  /** what the product was called before the fix: never again */
  never: string;
  /** the first try's anchors, in order */
  anchors: string[];
  botCheck?: string;
}

const ROWS: Row[] = [
  {
    name: "a Telegram bot whose address the picture reader read as “T”",
    url: BOT,
    kind: "telegram_bot",
    pages: { [BOT]: "listing-telegram" },
    browser: run(BOT, {
      states: [state(BOT, "initial load", "Download\nDOWNLOAD FOR MAC\nLedger Lark\n@ledgerlarkbot\nSplits a shared bill and reminds everyone what they owe.\nSEND MESSAGE\nIf you have Telegram, you can contact Ledger Lark right away.", ["Download", "DOWNLOAD FOR MAC", "SEND MESSAGE"]), state(BOT, 'clicked "SEND MESSAGE"', "Open Telegram Desktop?\nDownload", ["Download"])],
      visionObservations: [picture(["Telegram", "Ledger Lark", "@ledgerlarkbot", "SEND MESSAGE", "t.me"])],
    }),
    product: "@ledgerlarkbot",
    never: "T",
    anchors: ["@ledgerlarkbot", "Splits a shared bill and reminds everyone what they owe."],
  },
  {
    name: "a GitHub repository whose title ends in “GitHub”",
    url: REPO,
    kind: "code_repo",
    pages: { [REPO]: "listing-repo", [`${REPO}/issues`]: "listing-repo-issues" },
    browser: run(REPO, {
      states: [state(REPO, "initial load", REPO_SCREEN, ["Skip to content", "Sign in", "Issues", "Go to file", "View all files"]), state(REPO, 'clicked "View all files"', "Files\nsrc\nREADME.md", ["Go to file"])],
      pages: [pageSeen(`${REPO}/issues`, "Issues · harborworks/tidewatch · GitHub", "Issues", ["Skip to content", "Sign in", "New issue"], "Skip to content\nNavigation Menu\nSign in\nIssues\nWrong low water time for harbours east of Greenwich after the clocks change.")],
      visionObservations: [picture(["GitHub", "harborworks / tidewatch", "Sign in", "View all files", "README"])],
    }),
    product: "tidewatch",
    never: "GitHub",
    anchors: ["tidewatch", "Run tidewatch next brixham to print the next high and low water for Brixham in local time.", "Tide tables for any harbour, from the command line.", "The first lookup for a harbour saves a year of predictions under your home folder, so"],
  },
  {
    name: "a PyPI package whose plain read was answered with a bot check",
    url: PKG,
    kind: "package",
    pages: { [PKG]: "listing-bot-check" },
    browser: run(PKG, {
      mode: "static",
      pages: [pageSeen(PKG, "slatecsv · PyPI", "slatecsv 1.8.0", ["Skip to main content", "Search PyPI", "Search", "Log in"],
        "Skip to main content\nSearch PyPI\nSearch\nHelp\nDocs\nSponsors\nLog in\nRegister\nslatecsv 1.8.0\npip install slatecsv\nCopy PIP instructions\nLatest version\nReleased: Oct 2, 2026\nRead a messy CSV file into clean rows, guessing the delimiter and the header.\nNavigation\nProject description\nRelease history\nDownload files\nVerified details\nThese details have been verified by PyPI\nMaintainers\nProject description\nslatecsv opens a file, works out how it is delimited and hands back a list of dictionaries.")],
    }),
    product: "slatecsv",
    never: "PyPI",
    anchors: ["slatecsv 1.8.0", "pip install slatecsv", "slatecsv opens a file, works out how it is delimited and hands back a list of", "Read a messy CSV file into clean rows, guessing the delimiter and the header."],
    botCheck: "Client Challenge",
  },
  {
    name: "an App Store listing whose title ends in “App Store”",
    url: APP,
    kind: "mobile_app",
    pages: { [APP]: "listing-app-store" },
    browser: run(APP, {
      states: [state(APP, "initial load", "Apple\nToday\nGames\nApps\nArcade\nSearch\nLanternly - Night Reader\nfor iPhone\nRead long articles in the dark\nFree · Offers In-App Purchases\nView in Mac App Store\nLanternly turns any saved article into warm, low-light pages and remembers the line you stopped on.\nWhat’s New\nRatings and Reviews\n4.7 out of 5\n1.2K Ratings", ["Search", "Today", "Games", "View in Mac App Store"])],
      visionObservations: [picture(["App Store", "Today", "Games", "Lanternly - Night Reader", "for iPhone"])],
    }),
    product: "Lanternly - Night Reader",
    never: "App Store",
    anchors: ["Lanternly - Night Reader", "Lanternly turns any saved article into warm, low-light pages and remembers the line you", "Version 3.1 adds a sleep timer that dims the page over twenty minutes.", "Read long articles in the dark"],
  },
  {
    name: "a Chrome Web Store listing",
    url: EXT,
    kind: "browser_extension",
    pages: { [EXT]: "listing-extension" },
    browser: run(EXT, {
      states: [state(EXT, "initial load", "chrome web store\nDiscover\nExtensions\nThemes\nSign in\nView guide\nPagePebble\n4.6 (310 ratings)\nExtension\n20,000 users\nAdd to Chrome\nOverview\nPagePebble leaves a small pebble where you stopped reading, on any page, and takes you back to it.\nDetails\nPrivacy\nThe developer has disclosed that it will not collect or use your data.", ["View guide", "chrome web store", "Sign in", "Discover", "Add to Chrome"])],
      visionObservations: [picture(["chrome web store", "PagePebble", "Add to Chrome", "Sign in"])],
    }),
    product: "PagePebble",
    never: "Chrome Web Store",
    anchors: ["PagePebble", "PagePebble leaves a small pebble where you stopped reading, on any page, and takes you"],
  },
  {
    name: "a Discord invite, blank until its scripts run",
    url: INVITE,
    kind: "community",
    pages: { [INVITE]: "listing-discord" },
    browser: run(INVITE, {
      states: [state(INVITE, "initial load", "You've been invited to join\nKiln Club\n1,204 Online\n9,870 Members\nDisplay Name\nThis is how others see you. You can use special characters and emoji.\nContinue\nAlready have an account?", ["Create Account", "Continue", "Already have an account?"])],
      visionObservations: [picture(["Discord", "You've been invited to join", "Kiln Club", "1,204 Online"])],
    }),
    product: "Kiln Club",
    never: "Discord",
    anchors: ["Kiln Club"],
  },
];

/* ─────────────────────────────────────────────────────────── the harness ── */

type Mode = "empty_account" | "healthy";

function outsideWorld(row: Row, mode: Mode): { zoo: Zoo; other: string[] } {
  const other: string[] = [];
  const core = { mainAction: "", startsAt: "", rank: "lead", purpose: "You most likely want to know whether strangers get what this is and can try it.", why: "You asked whether people get it." };
  const zoo = new Zoo((c) => {
    if (c.system === ARCHITECT_SYSTEM) return { core, missions: [] };
    if (c.system === CRITIC_SYSTEM) return { critiques: [] };
    if (c.system === CORE_DECISION_SYSTEM) return { core };
    return {};
  });
  if (mode === "empty_account") for (const h of HOSTS) zoo.set(h, "empty_account");
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const u = new URL(url);
    if (u.host.endsWith(".zoo.test")) return zoo.fetch(input, init);
    if (u.host === "api.github.com") {
      if (u.pathname === "/repos/harborworks/tidewatch") return json({ default_branch: "main" });
      if (u.pathname === "/repos/harborworks/tidewatch/git/trees/main") return json({ tree: [{ path: "README.md", type: "blob", size: 700 }, { path: "Cargo.toml", type: "blob", size: 200 }] });
      return json({ message: "Not Found" }, 404);
    }
    if (u.host === "raw.githubusercontent.com") return new Response("# tidewatch\n\nTide tables for any harbour, from the command line.\n");
    const name = row.pages[url.replace(/#.*$/, "")];
    if (!name) other.push(url);
    return new Response(name ? pageHtml(name) : "<title>Not found</title>", { status: name ? 200 : 404, headers: { "content-type": "text/html; charset=utf-8" } });
  });
  return { zoo, other };
}

/**
 * THE BATTERY'S OWN RULER (scripts/mission-eval-matrix.mjs, `rebuildCorpus` and `norm`), on the map as it is
 * stored: every string leaf of the serialized map, undelivered states pruned. An anchor the gate accepted from
 * the static read alone is NOT here, because the static read is not stored; that is how a row read 0%.
 */
const ruler = (s: string): string =>
  (s || "").toLowerCase().replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″]/g, '"').replace(/[‐-―−]/g, "-").replace(/[   ]/g, " ").replace(/…/g, "...").replace(/\s+/g, " ").trim();
function storedMapCorpus(map: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown, key: string): void => {
    if (node === null || node === undefined) return;
    if (typeof node === "string") { if (node.trim()) parts.push(node); return; }
    if (typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const v of node) {
        if (key === "states" && v && typeof v === "object" && (v as { delivered?: boolean }).delivered === false) continue;
        walk(v, key);
      }
      return;
    }
    for (const [k, v] of Object.entries(node)) walk(v, k);
  };
  walk(JSON.parse(JSON.stringify(map)), "map");
  return ruler(parts.join(" • "));
}

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
  if (process.env.ZOO_TABLE) process.stdout.write(`${["mode | kind | product | anchors", ...table].join("\n")}\n`);
});

describe("six listings: the product's name and its own words, at zero credit and with a healthy model", () => {
  const MODES: Mode[] = ["empty_account", "healthy"];
  it.each(MODES.flatMap((mode) => ROWS.map((row) => ({ mode, ...row }))))("$mode: $name", async ({ mode, ...row }) => {
    hoisted.fieldTest = row.browser;
    const out = outsideWorld(row, mode);
    const { value: r } = await onFakeClock(() =>
      inspectAndPlan({ productUrl: row.url, goal: "see whether strangers get it and can try it", targetUsers: "", totalBudgetBase: BUDGET, tokenDecimals: 6 }, `listing-${row.kind}`, () => {}, 1, { inspectionId: `listing-${row.kind}-${mode}` }),
    );
    expect(r.stage, `${r.reason} ${JSON.stringify(r.questions)}`).toBe("ready");
    const map = r.map!;
    const plan = r.plan!;
    const book = KIND_PLAYBOOK[row.kind];
    expect(kindOfMap(map)).toBe(row.kind);

    // 1. THE NAME: the product's, on the map and in every sentence of the mission; never the platform's
    expect(map.productName).toBe(row.product);
    const first = r.brain!.accepted.find((m) => m.missionKey === CORE_MISSION_KEY)!;
    expect(first, "the first-try mission").toBeTruthy();
    expect(first.title).toBe(`Try ${row.product} for the first time and say how far you got`);
    const words = [first.title, first.objective, first.instructions, ...first.criteria, ...first.evidenceRequirements, first.whyItMatters].join("\n");
    expect(words).not.toMatch(new RegExp(`(?:Try|what|is|install|open|use) ${row.never.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (?:for the first time|is and who|and who|again|on your|in Telegram)`));
    // the first look says the same name
    expect(JSON.stringify(plainLookFor(map, row.url))).not.toContain(`"${row.never}"`);

    // 2. THE ANCHORS: the product's own words on its listing
    expect(first.anchors).toEqual(row.anchors);
    for (const a of first.anchors!) {
      expect(isPlatformChrome(a), `furniture: ${a}`).toBe(false);
      expect(isBotCheck(a), `a bot check: ${a}`).toBe(false);
    }
    // ...which are also what the core-place question and the map carry as the page's words
    for (const s of map.productKind!.seen) expect(isPlatformChrome(s), `furniture on the map: ${s}`).toBe(false);

    // 3. IN THE GATE'S CORPUS, and in the stored map by the battery's ruler: integrity 100% for the whole plan
    const inspection = hoisted.inspections[0]!.result as InspectResult;
    const corpus = buildObservationCorpus(inspection.observations, map.fieldTest);
    const stored = storedMapCorpus(map);
    let anchored = 0;
    for (const m of plan.missions) {
      const full = r.brain!.accepted.find((x) => x.missionKey === m.missionKey)!;
      expect(anchorIssues(full, corpus), m.missionKey).toEqual([]);
      const anchors = (full.anchors ?? []).map(ruler).filter((x) => x.length >= 3);
      for (const a of anchors) expect(stored.includes(a), `not in the stored map: ${a}`).toBe(true);
      if (anchors.length > 0 && anchors.every((x) => stored.includes(x))) anchored++;
    }
    expect(Math.round((anchored / plan.missions.length) * 100)).toBe(100);

    // 4. THE HONESTY LINE is unchanged and first; a bot check is said, in the page's own words
    expect(map.limitations[0]).toBe(book.honesty);
    expect(first.verificationMethod).toContain(book.honesty);
    const said = map.limitations.filter((l) => /bot check/.test(l));
    if (row.botCheck) expect(said).toEqual([`The address answered one of Sage's reads with a bot check (“${row.botCheck}”) instead of the product's page, so Sage read less there than a person would see.`]);
    else expect(said).toEqual([]);

    // 5. no network but the saved pages; at zero credit no model had a part in the plan
    expect(out.other.filter((u) => !row.pages[u.replace(/#.*$/, "")] && new URL(u).host !== new URL(row.url).host)).toEqual([]);
    if (mode === "empty_account") expect(out.zoo.calls.every((c) => c.host.endsWith(".zoo.test"))).toBe(true);

    table.push(`${mode} | ${row.kind} | ${map.productName} | ${first.anchors!.map((a) => `“${a}”`).join(", ")}`);
  }, 60_000);
});
