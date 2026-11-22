import { describe, expect, it } from "vitest";
import { coreAnchors } from "./core-mission";
import { addressNames, botCheckSeen, detectProductKind, isBotCheck, isPlatformChrome, kindProductName, listingWords } from "./product-kind";
import { buildProductMap } from "./product-map";
import type { FieldTestSummary, FounderLaunchInput, ProductObservation, VisionObservation } from "./schemas";
import { buildObservationCorpus } from "./validate-mission";

/**
 * A product listed on someone else's platform: its name, its own words, and the platform's furniture
 * (23 Nov 2026). The six listings are run through the whole pipeline in tests/model-zoo/listings.test.ts;
 * these pin the rules one at a time.
 */
const obs = (url: string, over: Partial<ProductObservation> = {}): ProductObservation => ({
  url, status: 200, title: "", headings: [], claims: [], ctas: [], forms: [], links: [], authBoundary: false,
  techHints: [], states: [], landmarks: [], snippets: [], inspectedAt: 1, contentSha256: "a".repeat(64), ...over,
});
const founder = (productUrl: string): FounderLaunchInput => ({ productUrl, goal: "see if people get it", targetUsers: "", totalBudgetBase: BigInt(10_000_000), tokenDecimals: 6 });
const state = (url: string, text: string) => ({ trigger: "initial load", screenshot: null, visibleTextExcerpt: text, notableElements: [], pixelDeltaPct: 60, url });
const browser = (url: string, over: Partial<FieldTestSummary>): FieldTestSummary => ({ ran: true, startUrl: url, mode: "interactive", pages: [], states: [], classification: null, limitation: null, durationMs: 1, ...over }) as FieldTestSummary;
const picture = (visibleText: string[]): VisionObservation => ({ stateIndex: 0, trigger: "initial load", sceneDescription: "A listing on a platform.", visibleText, uiElements: [], productTypeSignals: [], audienceSignals: [], qualityIssues: [] });

describe("the name of a listed product is decided once, and the picture reader does not rename it", () => {
  const rows: { url: string; title: string; headings?: string[]; seen: string[]; name: string }[] = [
    // the three the live battery got wrong: "T", "GitHub", "App Store"
    { url: "https://t.me/ledgerlarkbot", title: "Telegram: Contact @ledgerlarkbot", seen: ["Telegram", "Ledger Lark", "t.me"], name: "@ledgerlarkbot" },
    { url: "https://github.com/harborworks/tidewatch", title: "GitHub - harborworks/tidewatch: Tide tables · GitHub", seen: ["GitHub", "harborworks / tidewatch"], name: "tidewatch" },
    { url: "https://apps.apple.com/us/app/lanternly/id1", title: "‎Lanternly - Night Reader App - App Store", headings: ["Lanternly - Night Reader"], seen: ["App Store", "Today", "Lanternly - Night Reader"], name: "Lanternly - Night Reader" },
    { url: "https://chromewebstore.google.com/detail/pagepebble/abc", title: "PagePebble - Chrome Web Store", headings: ["PagePebble"], seen: ["chrome web store", "PagePebble"], name: "PagePebble" },
    { url: "https://pypi.org/project/slatecsv/", title: "slatecsv · PyPI", seen: ["PyPI", "slatecsv 1.8.0"], name: "slatecsv" },
  ];
  it.each(rows)("$url is $name", ({ url, title, headings, seen, name }) => {
    const o = [obs(url, { title, headings: headings ?? [] })];
    const ft = browser(url, { states: [state(url, seen.join("\n")), state(url, "second screen")], visionObservations: [picture(seen)] });
    expect(buildProductMap(o, [], founder(url), ft).productName).toBe(name);
    // ...and with no browser at all
    expect(buildProductMap(o, [], founder(url), null).productName).toBe(name);
  });

  it("reads the name from the browser's page when the plain read was refused or answered with a bot check", () => {
    const url = "https://apps.apple.com/us/app/lanternly/id1";
    const ft = browser(url, { mode: "static", pages: [{ url, title: "‎Lanternly - Night Reader App - App Store", h1: "Lanternly - Night Reader", ctas: [], forms: [], consoleErrors: [], brokenRequests: [], jsOnly: false, screenshot: null }] });
    expect(kindProductName(url, [], ft)).toBe("Lanternly - Night Reader");
    expect(kindProductName(url, [obs(url, { title: "Just a moment...", headings: ["Verify you are human"] })], ft)).toBe("Lanternly - Night Reader");
    // a bot check alone names nothing: a plain noun, never "Just a moment"
    expect(kindProductName(url, [obs(url, { title: "Just a moment..." })], null)).toBe("this app");
  });

  it("a product on its own site is named as it always was, picture reader included", () => {
    const url = "https://yara.garden/";
    const o = [obs(url, { title: "Yara — a gentle world to heal", headings: ["Welcome"] })];
    const ft = browser(url, { states: [state(url, "Yara\nEnter"), state(url, "A garden")], visionObservations: [picture(["Yara", "Enter"])] });
    expect(kindProductName(url, o, ft)).toBeNull();
    expect(buildProductMap(o, [], founder(url), ft).productName).toBe("Yara");
  });
});

describe("the platform's furniture is not the product", () => {
  it.each([
    "Search", "Sign in", "Skip to main content", "Skip to content", "View all files", "Search PyPI", "Client Challenge", "Today", "Games", "for iPhone", "View guide", "chrome web store", "Discover",
    "Create Account", "You've been invited to join", "44,286 Online", "9,870 Members", "DOWNLOAD FOR MAC", "Issues", "Issues · colinhacks/zod · GitHub", "Navigation Menu", "Pull requests",
    "You signed in with another tab or window. Reload to refresh your session.", "We read every piece of feedback, and take your input very seriously.", "Add to Chrome", "Ratings and Reviews",
    "The developer, Acme Studio, indicated that the app’s privacy practices may include handling of data as described below.", "If you have Telegram, you can contact Ledger Lark right away.",
    "This is how others see you. You can use special characters and emoji.", "Just a moment...", "Verify you are human", "4.7 out of 5", "Fix the tide offset (#212)", "3 weeks ago", "Accept all cookies",
  ])("furniture: %s", (s) => expect(isPlatformChrome(s)).toBe(true));

  it.each([
    "tidewatch", "Quickstart", "Quick tour", "Installation", "Usage", "Caching a harbour", "@ledgerlarkbot", "Kiln Club", "pip install slatecsv", "slatecsv 1.8.0", "Lanternly - Night Reader",
    "Splits a shared bill and reminds everyone what they owe.", "Tide tables for any harbour, from the command line.", "AI agent with eyes, judgment, and a wallet.",
    "Run tidewatch next brixham to print the next high and low water for Brixham in local time.", "Read long articles in the dark",
  ])("the product's own: %s", (s) => expect(isPlatformChrome(s)).toBe(false));

  it("knows a bot check by its title or first line, and nothing else by accident", () => {
    for (const s of ["Client Challenge", "Just a moment...", "Attention Required! | Cloudflare", "Verifying you are human. This may take a few seconds.", "Enable JavaScript and cookies to continue", "JavaScript is disabled in your browser."]) expect(isBotCheck(s), s).toBe(true);
    for (const s of ["The coding challenge platform", "Human Design Studio", "Wait less, ship more", "Security for small teams", "Client portal"]) expect(isBotCheck(s), s).toBe(false);
  });
});

describe("a listing's own words", () => {
  const url = "https://github.com/harborworks/tidewatch";
  const chromeHeadings = ["Search code, repositories, users, issues, pull requests...", "Provide feedback", "Saved searches", "Navigation Menu", "Folders and files", "Latest commit", "History", "Repository files navigation"];
  const page = obs(url, {
    title: "GitHub - harborworks/tidewatch: Tide tables for any harbour · GitHub",
    headings: [...chromeHeadings, "tidewatch", "Quick tour", "About", "Releases"],
    ctas: ["Sign in", "Search", "Sign up", "View all files"],
    snippets: ["We read every piece of feedback, and take your input very seriously.", "You signed in with another tab or window. Reload to refresh your session.", "Tide tables for any harbour, from the command line. One binary, no account, works offline once a harbour is cached."],
  });

  it("are the README's title, its description and its headings: never the host's navigation", () => {
    const words = listingWords(url, [page], null);
    expect(words).toEqual(["tidewatch", "Tide tables for any harbour, from the command line.", "Quick tour"]);
    expect(detectProductKind({ url, observations: [page], fieldTest: null }).seen).toEqual(words);
  });

  it("the first try anchors on them, and every anchor is in the corpus", () => {
    const corpus = buildObservationCorpus([page], null);
    const seen = listingWords(url, [page], null);
    const anchors = coreAnchors({ fieldTest: undefined, productKind: { kind: "code_repo", because: "a GitHub repository address", seen } }, corpus, "View all files", null, url);
    expect(anchors).toEqual(["tidewatch", "Tide tables for any harbour, from the command line.", "Quick tour", "harborworks/tidewatch"]);
  });

  it("a page that was only a bot check gives no words; the mission anchors on the name the address gives, and the limits say so", () => {
    const pkg = "https://pypi.org/project/slatecsv/";
    const wall = obs(pkg, { title: "Client Challenge", headings: ["JavaScript is disabled in your browser."], snippets: ["A required part of this site couldn’t load. This may be due to a browser extension, network issues, or browser settings."] });
    expect(listingWords(pkg, [wall], null)).toEqual([]);
    expect(botCheckSeen(pkg, [wall], null)).toBe("Client Challenge");
    const corpus = buildObservationCorpus([wall], null);
    expect(coreAnchors({ fieldTest: undefined, productKind: { kind: "package", because: "a PyPI package address", seen: [] } }, corpus, null, null, pkg)).toEqual(["slatecsv"]);
    const map = buildProductMap([wall], [], founder(pkg), null);
    expect(map.productName).toBe("slatecsv");
    expect(map.limitations.join(" ")).toContain("answered one of Sage's reads with a bot check (“Client Challenge”)");
    // never said about a product on its own site
    expect(botCheckSeen("https://slatecsv.dev/", [obs("https://slatecsv.dev/", { title: "Client Challenge" })], null)).toBeNull();
  });

  it("a page blank until its scripts run gives the product's part of its title", () => {
    const fig = "https://www.figma.com/proto/A/Checkout-flow";
    expect(listingWords(fig, [obs(fig, { title: "Checkout flow – Figma" })], null)).toEqual(["Checkout flow"]);
  });

  it("the address names: the name, a handle without its @, a repository's owner and name", () => {
    expect(addressNames("https://t.me/ledgerlarkbot")).toEqual(["@ledgerlarkbot", "ledgerlarkbot"]);
    expect(addressNames(url)).toEqual(["tidewatch", "harborworks/tidewatch"]);
    expect(addressNames("https://apps.apple.com/us/app/x/id1")).toEqual([]);
    expect(addressNames("https://example.com/")).toEqual([]);
  });

  it("a product on its own site is untouched: the same anchors with or without the new argument", () => {
    const site = "https://getdrops.app/";
    const o = obs(site, { title: "Drops", headings: ["Send a gift to anyone"], ctas: ["Sign in", "Start a drop"] });
    const kind = detectProductKind({ url: site, observations: [o], fieldTest: null });
    expect(kind).toEqual({ kind: "website", because: "a site Sage can open in its browser", seen: ["Send a gift to anyone", "Drops", "Sign in", "Start a drop"] });
    const corpus = buildObservationCorpus([o], null);
    const screen = { title: o.title, headings: o.headings, ctas: o.ctas };
    expect(coreAnchors({ fieldTest: undefined }, corpus, "Start a drop", screen)).toEqual(coreAnchors({ fieldTest: undefined }, corpus, "Start a drop", screen, null));
    expect(coreAnchors({ fieldTest: undefined }, corpus, "Start a drop", screen)).toEqual(["Start a drop", "Send a gift to anyone", "Drops", "Sign in"]);
  });
});
