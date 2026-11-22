import { describe, expect, it } from "vitest";
import { CORE_MISSION_KEY } from "@/lib/core-test/shape";
import { mainActionOf } from "@/lib/report/product";
import { addCoreMission, buildCoreMission, coreHintLadder, GENERIC_ACTION } from "./core-mission";
import { detectUnsupportedEvidence } from "./evidence-capabilities";
import { underPath } from "./inspect";
import { buildArchitectUser } from "./mission-prompt";
import { detectProductKind, KIND_PLAYBOOK, kindFromUrl, kindHonestyLine, kindLineFor, kindOfMap, kindProductName, kindProofIssue, PRODUCT_KINDS, sageReadsOnly, type ProductKind } from "./product-kind";
import { buildProductMap, scopeFromObservations } from "./product-map";
import type { CandidateMission, FieldTestSummary, FounderLaunchInput, ProductObservation } from "./schemas";
import { buildObservationCorpus, classifyVerifiability, validatePlanMissions } from "./validate-mission";

/**
 * The product's kind: decided from the address and what Sage saw, with no model; and, per kind, the fixed
 * first-try words and the proof rule. The whole pipeline is run per kind in tests/model-zoo/product-kinds.test.ts;
 * these pin the rules one at a time.
 */
const obs = (url: string, over: Partial<ProductObservation> = {}): ProductObservation => ({
  url, status: 200, title: "Acme", headings: ["Acme does one thing well"], claims: [], ctas: [], forms: [], links: [], authBoundary: false,
  techHints: [], states: [], landmarks: [], snippets: ["Acme does one thing well, for people who need that thing done."], inspectedAt: 1, contentSha256: "a".repeat(64), ...over,
});
const founder = (productUrl: string): FounderLaunchInput => ({ productUrl, goal: "see if people get it", targetUsers: "", totalBudgetBase: BigInt(10_000_000), tokenDecimals: 6 });
const kindOf = (url: string, over: Partial<ProductObservation> = {}, fieldTest: FieldTestSummary | null = null) => detectProductKind({ url, observations: [obs(url, over)], fieldTest }).kind;

describe("the address decides, where it names a platform", () => {
  const rows: [string, ProductKind, string | null][] = [
    ["https://t.me/pricewatch_bot", "telegram_bot", "/pricewatch_bot"],
    ["https://t.me/PriceWatchBot?start=abc", "telegram_bot", "/PriceWatchBot"],
    ["https://t.me/tapgarden_bot/play", "telegram_mini_app", "/tapgarden_bot"],
    ["https://t.me/tapgarden_bot?startapp=ref1", "telegram_mini_app", "/tapgarden_bot"],
    ["https://t.me/metisbuilders", "community", "/metisbuilders"],
    ["https://t.me/+AbCdEf123", "community", "/+AbCdEf123"],
    ["https://discord.gg/metisbuilders", "community", "/metisbuilders"],
    ["https://discord.com/invite/python", "community", "/invite/python"],
    ["https://discord.com/oauth2/authorize?client_id=1", "discord_bot", "/oauth2/authorize"],
    ["https://top.gg/bot/771234567890123456", "discord_bot", "/bot/771234567890123456"],
    ["https://github.com/acme/quickqueue", "code_repo", "/acme/quickqueue"],
    ["https://github.com/acme/quickqueue/tree/main/examples", "code_repo", "/acme/quickqueue"],
    ["https://gitlab.com/acme/quickqueue", "code_repo", "/acme/quickqueue"],
    ["https://www.npmjs.com/package/zod", "package", "/package/zod"],
    ["https://www.npmjs.com/package/@acme/queue", "package", "/package/@acme/queue"],
    ["https://pypi.org/project/tinytable/", "package", "/project/tinytable"],
    ["https://crates.io/crates/serde", "package", "/crates/serde"],
    ["https://apps.apple.com/us/app/tidepool-habits/id1234567890", "mobile_app", "/us/app/tidepool-habits/id1234567890"],
    ["https://play.google.com/store/apps/details?id=app.tidepool", "mobile_app", "/store/apps/details"],
    ["https://testflight.apple.com/join/AbCd1234", "mobile_app", "/join/AbCd1234"],
    ["https://example-cdn.com/builds/tidepool-2.3.apk", "mobile_app", "/builds/tidepool-2.3.apk"],
    ["https://chromewebstore.google.com/detail/tabtidy/abcdefghijklmnopabcdefghijklmnop", "browser_extension", "/detail/tabtidy/abcdefghijklmnopabcdefghijklmnop"],
    ["https://addons.mozilla.org/en-US/firefox/addon/tabtidy/", "browser_extension", "/en-US/firefox/addon/tabtidy"],
    ["https://www.figma.com/proto/AbC123/Checkout-flow", "design_prototype", "/proto/AbC123/Checkout-flow"],
    ["https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184", "video_demo", "/share/0281766fa2d04bb788eaf19e65135184"],
    ["https://www.youtube.com/watch?v=abc123", "video_demo", "/watch"],
    ["https://youtu.be/abc123", "video_demo", "/abc123"],
    ["https://notchnotes.app/downloads/NotchNotes-2.1.dmg", "desktop_app", "/downloads/NotchNotes-2.1.dmg"],
  ];
  it.each(rows)("%s is %s", (url, kind, prefix) => {
    const k = kindFromUrl(url);
    expect(k?.kind).toBe(kind);
    expect(k?.scope?.pathPrefix).toBe(prefix);
    // the same answer through the full detector, whatever the page says
    expect(kindOf(url, { title: "Log in", ctas: ["Connect Wallet", "Join the waitlist"] })).toBe(kind);
  });

  it.each([
    "https://github.com/pricing", "https://github.com/features/copilot", "https://github.com/acme", "https://t.me/s/durov", "https://t.me/",
    "https://www.figma.com/pricing", "https://www.youtube.com/@acme", "https://vimeo.com/features", "https://discord.com/", "https://www.npmjs.com/",
    "https://plotline.app/", "not a url",
  ])("%s is not a product listing: what Sage saw decides", (url) => {
    expect(kindFromUrl(url)).toBeNull();
  });

  it("a Telegram bot whose name does not end in bot is known by its page's own title", () => {
    const page = (title: string) => detectProductKind({ url: "https://t.me/BotFather", observations: [obs("https://t.me/BotFather", { title })] }).kind;
    expect(page("Telegram: Launch @BotFather")).toBe("telegram_bot");
    expect(page("Telegram: View @BotFather")).toBe("community");
  });

  it("on a shared platform, only the product's own path is the product", () => {
    expect(underPath("/acme/quickqueue", "/acme/quickqueue")).toBe(true);
    expect(underPath("/acme/quickqueue/issues", "/acme/quickqueue")).toBe(true);
    expect(underPath("/Acme/QuickQueue/", "/acme/quickqueue")).toBe(true);
    expect(underPath("/acme/quickqueue-pro", "/acme/quickqueue")).toBe(false);
    expect(underPath("/pricing", "/acme/quickqueue")).toBe(false);
  });

  it("names the product from the address or the title's own part, never the platform", () => {
    expect(kindProductName("https://github.com/acme/quickqueue", [obs("https://github.com/acme/quickqueue", { title: "GitHub - acme/quickqueue: A tiny job queue · GitHub" })])).toBe("quickqueue");
    expect(kindProductName("https://t.me/pricewatch_bot", [])).toBe("@pricewatch_bot");
    expect(kindProductName("https://apps.apple.com/us/app/x/id1", [obs("https://apps.apple.com/us/app/x/id1", { title: "\u200eSignal - Private Messenger App - App Store", headings: [] })])).toBe("Signal");
    expect(kindProductName("https://play.google.com/store/apps/details?id=a.b", [obs("https://play.google.com/store/apps/details?id=a.b", { title: "Signal Private Messenger - Apps on Google Play", headings: [] })])).toBe("Signal Private Messenger");
    expect(kindProductName("https://chromewebstore.google.com/detail/x/y", [obs("https://chromewebstore.google.com/detail/x/y", { title: "uBlock Origin Lite - Chrome Web Store", headings: ["uBlock Origin Lite"] })])).toBe("uBlock Origin Lite");
    expect(kindProductName("https://www.figma.com/proto/A/B", [obs("https://www.figma.com/proto/A/B", { title: "Checkout flow \u2013 Figma", headings: [] })])).toBe("Checkout flow");
    // a long title is cut at its colon; with nothing usable, a plain noun, never the platform's name
    expect(kindProductName("https://www.loom.com/share/a", [obs("https://www.loom.com/share/a", { title: "Plotline demo: plan a week of meals in two minutes | Loom", headings: [] })])).toBe("Plotline demo");
    expect(kindProductName("https://www.loom.com/share/a", [obs("https://www.loom.com/share/a", { title: "Loom", headings: [] })])).toBe("this demo");
    expect(kindProductName("https://plotline.app/", [obs("https://plotline.app/")])).toBeNull();
  });
});

describe("what Sage saw decides, on an ordinary address", () => {
  it("a Connect wallet control is a dapp", () => {
    expect(kindOf("https://app.hummusvault.xyz/", { ctas: ["Docs", "Connect Wallet"] })).toBe("wallet_dapp");
    expect(kindOf("https://app.hummusvault.xyz/", { snippets: ["Connect your wallet to view your positions."] })).toBe("wallet_dapp");
    // the word "wallet" in the copy is not a wall
    expect(kindOf("https://paylater.app/", { snippets: ["Works with every wallet and card you already have."] })).toBe("website");
  });

  it("a pre-launch page with nothing to use is a waitlist; a product with a waitlist for one feature is not", () => {
    expect(kindOf("https://orbitmail.xyz/", { headings: ["Email that sorts itself", "Coming soon"], ctas: ["Join the waitlist"] })).toBe("waitlist");
    expect(kindOf("https://orbitmail.xyz/", { headings: ["Email that sorts itself"], snippets: ["Our mobile app is coming soon."], ctas: ["Log in", "Start free"] })).toBe("website");
  });

  it("a box to ask a question in is a chat product; a support line in the copy is not", () => {
    expect(kindOf("https://askfern.ai/", { headings: ["How can I help with your taxes today?"] })).toBe("ai_chat");
    expect(kindOf("https://chat.acme.dev/")).toBe("ai_chat");
    expect(kindOf("https://acme.dev/", { snippets: ["Questions? Send a message to our team and ask anything."] })).toBe("website");
  });

  it("a download for a computer, a page that only points at an app store, and an API with a key", () => {
    expect(kindOf("https://notchnotes.app/", { ctas: ["Download for Mac", "Download for Windows"] })).toBe("desktop_app");
    expect(kindOf("https://tidepool.app/", { ctas: ["Download on the App Store", "Get it on Google Play"] })).toBe("mobile_app");
    // a web app that also has phone apps is still a web app
    expect(kindOf("https://tidepool.app/", { ctas: ["Log in", "Download on the App Store"] })).toBe("website");
    expect(kindOf("https://api.weathergrid.dev/", { title: "The WeatherGrid API", snippets: ["Sign up for a free API key, then call the forecast endpoint with curl."] })).toBe("api");
    expect(kindOf("https://plausible.example/", { title: "Simple analytics", snippets: ["Create an API key to use our endpoints."] })).toBe("website");
  });

  it("an app builder's host, or a page that is blank until its scripts run, is a single-page app", () => {
    expect(kindOf("https://plotline-planner.vercel.app/")).toBe("single_page_app");
    expect(kindOf("https://plotline.lovable.app/")).toBe("single_page_app");
    const jsOnly = { ran: true, startUrl: "https://plotline.app/", mode: "interactive", pages: [{ url: "https://plotline.app/", title: "Plotline", h1: null, ctas: [], forms: [], consoleErrors: [], brokenRequests: [], jsOnly: true, screenshot: null }], states: [], classification: null, limitation: null, durationMs: 1 } as unknown as FieldTestSummary;
    expect(kindOf("https://plotline.app/", {}, jsOnly)).toBe("single_page_app");
    expect(kindOf("https://plotline.app/")).toBe("website");
    // a bot wall answers the plain read with nothing too: that is not a single-page app
    const walled = { ...jsOnly, pages: [{ ...jsOnly.pages[0]!, jsOnly: false }] } as FieldTestSummary;
    expect(detectProductKind({ url: "https://www.bignews.com/", observations: [], fieldTest: walled }).kind).toBe("website");
  });

  it("the map carries the kind beside the category, and a website's map is exactly what it was", () => {
    const site = buildProductMap([obs("https://plotline.io/")], [], founder("https://plotline.io/"));
    expect(site.productKind).toBeUndefined();
    expect(kindOfMap(site)).toBe("website");
    expect(kindHonestyLine(site)).toBe("");
    expect(kindLineFor(site)).toBe("");
    const listing = buildProductMap([obs("https://apps.apple.com/us/app/tidepool/id1", { title: "\u200eTidepool Habits App - App Store", headings: ["Tidepool Habits"] })], [], founder("https://apps.apple.com/us/app/tidepool/id1"));
    expect(listing.productKind).toMatchObject({ kind: "mobile_app", because: "an App Store listing address" });
    expect(listing.productName).toBe("Tidepool Habits");
    expect(listing.category).toBeTruthy(); // the category is still there
    // the kind is added after the hash is taken, so the hash is over the same fields as before
    expect(listing.digest).toMatch(/^0x[0-9a-f]{64}$/);
    // a store listing has no "signup surface" to ask about
    expect(listing.openQuestions.join(" ")).not.toMatch(/signup\/onboarding surface/);
    expect(site.openQuestions.join(" ")).toMatch(/signup\/onboarding surface/);
    expect(sageReadsOnly(listing, "https://apps.apple.com/us/app/tidepool/id1")).toBe("the store listing");
    expect(sageReadsOnly(null, "https://t.me/pricewatch_bot")).toBe("the bot's Telegram page");
    expect(sageReadsOnly(site, "https://plotline.io/")).toBeNull();
  });

  it("the architect is told the kind in one trusted line, and nothing changes for a website", () => {
    const plain = buildArchitectUser("{}", { goal: "g", targetUsers: "" });
    expect(buildArchitectUser("{}", { goal: "g", targetUsers: "" }, { kindLine: "" })).toBe(plain);
    const told = buildArchitectUser("{}", { goal: "g", targetUsers: "" }, { kindLine: kindLineFor({ productKind: { kind: "telegram_bot" } }) });
    expect(told).toContain("PRODUCT KIND (decided by Sage from the address and what it saw; trusted): a Telegram bot.");
    expect(told.indexOf("PRODUCT KIND")).toBeLessThan(told.indexOf("PRODUCT MAP (UNTRUSTED"));
  });
});

describe("every kind's first-try mission", () => {
  const URL_ = "https://listing.example-store.com/app/tidepool";
  const o = obs(URL_, { title: "Tidepool Habits", headings: ["Tidepool Habits", "Build one habit at a time"], ctas: ["Start Bot"], snippets: ["Pick a habit, set a daily reminder, and watch your streak grow."] });
  const scope = scopeFromObservations([o], [], null);
  const corpus = buildObservationCorpus([o], null);
  const mapFor = (kind: ProductKind) => ({ productName: "Tidepool", fieldTest: null, observations: null, productKind: kind === "website" ? null : { kind, because: "test", seen: ["Tidepool Habits", "Build one habit at a time"] } });
  const kinds = PRODUCT_KINDS.filter((k) => KIND_PLAYBOOK[k].firstTry);

  it("covers every kind Sage cannot open like a site", () => {
    expect(kinds).toEqual(["wallet_dapp", "telegram_bot", "telegram_mini_app", "discord_bot", "community", "code_repo", "package", "api", "mobile_app", "browser_extension", "desktop_app", "waitlist", "ai_chat", "design_prototype", "video_demo"]);
    // a kind where people do the try always has its own words and an honest line
    for (const k of PRODUCT_KINDS) if (KIND_PLAYBOOK[k].peopleDoTheTry) expect(KIND_PLAYBOOK[k].firstTry && KIND_PLAYBOOK[k].honesty.length > 20, k).toBeTruthy();
  });

  it.each(kinds)("%s: passes the gate alone, with no model, in its own words", (kind) => {
    const core = addCoreMission({ map: mapFor(kind), productUrl: URL_, scope, corpus, accepted: [], modelHint: null });
    expect(core, kind).not.toBeNull();
    const m = core!.mission;
    const t = KIND_PLAYBOOK[kind].firstTry!;
    expect(m.missionKey).toBe(CORE_MISSION_KEY);
    expect(core!.hint.mainAction).toBe(t.defaultAction);
    expect(m.instructions).toContain(`try to ${t.defaultAction}`);
    expect(m.instructions).toContain(t.stop);
    expect(m.criteria[1]).toBe(`The answer names one specific thing from ${t.place} that matches what Sage read there.`);
    // four questions, in the report's order, and the report reads the action back from the third
    expect(m.evidenceRequirements).toHaveLength(4);
    expect(mainActionOf(m.evidenceRequirements)).toBe(t.defaultAction);
    // judged as the tester's account, never auto-verified by opening a page
    expect(classifyVerifiability(m)).toBe("observation-based");
    expect(kindProofIssue(m, kind, "observation-based")).toBeNull();
    expect(detectUnsupportedEvidence(m)).toBeNull();
    // the verification line says what Sage could not do
    expect(m.verificationMethod).toContain(KIND_PLAYBOOK[kind].honesty);
    expect(validatePlanMissions([m], scope, corpus).every((r) => r.ok)).toBe(true);
    // every anchor is something Sage read
    expect(m.anchors!.length).toBeGreaterThan(0);
    for (const a of m.anchors!) expect(corpus).toContain(a.toLowerCase());
    // never a money field
    for (const k of ["rewardUsd", "amount", "payout", "reward", "rewardBase"]) expect(m).not.toHaveProperty(k);
  });

  it("a website's first-try mission is word for word what it was", () => {
    const hint = { mainAction: "start a drop", startsAt: null, from: "model" as const };
    const ctx = { productName: "Drops", targetSurface: URL_, anchors: ["Tidepool Habits"], sources: [{ kind: "page" as const, ref: URL_, observation: "x" }] };
    expect(buildCoreMission(hint, ctx, "lead", "website")).toEqual(buildCoreMission(hint, ctx, "lead"));
    expect(buildCoreMission(hint, ctx, "lead", "single_page_app")).toEqual(buildCoreMission(hint, ctx, "lead"));
    expect(coreHintLadder(null, [], { fieldTest: null }, corpus).at(-1)!.mainAction).toBe(GENERIC_ACTION);
    expect(coreHintLadder(null, [], { fieldTest: null }, corpus, "telegram_bot").at(-1)!.mainAction).toBe("start it and use its main command");
  });
});

describe("a mission never asks for a proof Sage cannot read", () => {
  const m = (over: Partial<Pick<CandidateMission, "objective" | "criteria" | "evidenceRequirements" | "instructions">>) => ({
    objective: "Set a daily reminder and report what happened.", instructions: "1. Install it. 2. Set a reminder.", criteria: ["The answer says what the reminder screen asked for."], evidenceRequirements: ["What did the reminder screen ask you for?"], ...over,
  });
  it("a chat is not a page", () => {
    expect(kindProofIssue(m({ evidenceRequirements: ["Paste the link to the Telegram message where the bot replied."] }), "telegram_bot", "observation-based")).toMatch(/a chat is not a page/);
    expect(kindProofIssue(m({ criteria: ["The tester provides the Discord message link of the bot's answer."] }), "discord_bot", "observation-based")).toMatch(/a chat is not a page/);
    expect(kindProofIssue(m({ evidenceRequirements: ["What did the bot reply when you sent /price?"] }), "telegram_bot", "observation-based")).toBeNull();
  });
  it("on a listing, page-and-quote pays for reading, so it is refused", () => {
    const quote = m({ criteria: ["The tester reaches the page titled Tidepool Habits and quotes the text of the What's New heading."] });
    expect(classifyVerifiability(quote)).toBe("url-verifiable");
    expect(kindProofIssue(quote, "mobile_app", "url-verifiable")).toMatch(/pays for reading it/);
    expect(kindProofIssue(quote, "browser_extension", "url-verifiable")).toMatch(/pays for reading it/);
    // a repository or a site has pages worth reaching, and public results worth linking
    expect(kindProofIssue(quote, "code_repo", "url-verifiable")).toBeNull();
    expect(kindProofIssue(quote, "wallet_dapp", "url-verifiable")).toBeNull();
    expect(kindProofIssue(quote, "website", "url-verifiable")).toBeNull();
  });
  it("a dapp mission never needs a transaction's hash, and nobody hands over a key", () => {
    expect(kindProofIssue(m({ evidenceRequirements: ["What is the transaction hash shown after you confirmed?"] }), "wallet_dapp", "observation-based")).toMatch(/transaction/);
    expect(kindProofIssue(m({ evidenceRequirements: ["Include your API key in your answer so the call can be repeated."] }), "api", "observation-based")).toMatch(/hand over a key/);
  });
});

describe("what a tester reads before taking a place", () => {
  it("every kind is told never to type a recovery phrase or a private key, in one calm line", async () => {
    const { KIND_PLAYBOOK, NEVER_A_SECRET, testerCautions } = await import("./product-kind");
    for (const kind of Object.keys(KIND_PLAYBOOK) as (keyof typeof KIND_PLAYBOOK)[]) {
      const lines = testerCautions(kind);
      expect(lines[0], kind).toBe(NEVER_A_SECRET);
      expect(lines.length, kind).toBeLessThanOrEqual(3);
      for (const l of lines) {
        expect(l.length, l).toBeLessThanOrEqual(170);
        expect(l, l).not.toMatch(/!|\b(?:warning|danger|scam|beware|risk|hack)/i);
      }
    }
    expect(testerCautions(null)).toEqual([NEVER_A_SECRET]);
  });

  it("a dapp adds the empty wallet and where to stop; an install adds where it may come from", async () => {
    const { testerCautions } = await import("./product-kind");
    expect(testerCautions("wallet_dapp").slice(1)).toEqual([
      "Use a wallet with nothing in it you would mind losing. A new, empty one is best.",
      "Stop at the first request to confirm anything in your wallet. Stopping there earns the same.",
    ]);
    for (const kind of ["mobile_app", "browser_extension", "desktop_app"] as const) expect(testerCautions(kind)[1]).toMatch(/^Install it only from the address the mission names\./);
    for (const kind of ["code_repo", "package"] as const) expect(testerCautions(kind)[1]).toMatch(/without administrator rights and without any real key or password of yours\.$/);
  });

  it("the first-try WORDS say it too, because a mission's conditions are never shown to a tester", async () => {
    const { KIND_PLAYBOOK } = await import("./product-kind");
    const step = (kind: keyof typeof KIND_PLAYBOOK) => {
      const t = KIND_PLAYBOOK[kind].firstTry!;
      return `${t.how("X", "do it", "")} ${t.stop}`;
    };
    expect(step("wallet_dapp")).toContain("Use a wallet with nothing in it you would mind losing (a new, empty one is best), and never type a recovery phrase or a private key anywhere.");
    expect(step("wallet_dapp")).toContain("Stop at the first request to confirm anything in your wallet");
    expect(step("mobile_app")).toContain("If your phone warns you about the app");
    expect(step("browser_extension")).toContain("If your browser warns you about it");
    expect(step("desktop_app")).toContain("If your computer warns that it cannot check the app");
    expect(step("code_repo")).toContain("without administrator rights and without any real key or password of yours");
    expect(step("package")).toContain("without any real key or password of yours");
  });
});
