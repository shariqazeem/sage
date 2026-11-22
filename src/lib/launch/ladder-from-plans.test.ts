import { describe, expect, it } from "vitest";
import { actionFromTitle, addCoreMission, coreHintLadder, GENERIC_ACTION, headingAction, primaryCallToAction, type FirstScreen } from "./core-mission";
import { scopeFromObservations } from "./product-map";
import type { CandidateMission, FieldTestSummary, ProductMapV1 } from "./schemas";
import { buildObservationCorpus } from "./validate-mission";

/**
 * WHAT EVERY STORED PLAN TAUGHT THE MAIN-ACTION LADDER, as invented fixtures.
 *
 * The ladder was run with no model over the 911 ready plans production kept, and its answers were read
 * (`tests/plans-corpus/measure.live.test.ts`, part 4). Each test below is one way it read wrong, re-made with a
 * product that does not exist. Nothing from the stored plans is here.
 */
const URL_ = "https://inkpond.example/";

/** a first screen whose controls are these labels, in this order */
function product(controls: string[], over: { h1?: string; title?: string; name?: string } = {}) {
  const fieldTest: FieldTestSummary = {
    ran: true, startUrl: URL_, mode: "interactive", classification: null, limitation: null, durationMs: 1,
    pages: [],
    states: [
      { trigger: "initial load", screenshot: null, visibleTextExcerpt: ["Inkpond", "A quiet place to sketch", ...controls].join("\n"), notableElements: controls.map((text) => ({ tag: "button", text, role: "button" })), pixelDeltaPct: 100, url: URL_ },
      { trigger: "clicked a tool", screenshot: null, visibleTextExcerpt: "Brush size\nUndo\nLayers", notableElements: [{ tag: "button", text: "Undo", role: "button" }], pixelDeltaPct: 30, url: URL_ },
    ],
  };
  const map = { productName: over.name ?? "Inkpond", pagesInspected: 1, fieldTest } as unknown as ProductMapV1;
  const screen: FirstScreen = { productName: over.name ?? "Inkpond", title: over.title ?? "Inkpond", headings: over.h1 ? [over.h1] : [], ctas: [] };
  const observations = [{ url: URL_, status: 200, title: screen.title ?? "", headings: [...(screen.headings ?? [])], claims: [], ctas: [], forms: [], links: [], authBoundary: false, techHints: [], states: [], landmarks: [], snippets: [], inspectedAt: 1, contentSha256: "a".repeat(64) }];
  return { map, screen, fieldTest, corpus: buildObservationCorpus(observations, fieldTest), scope: scopeFromObservations(observations, [], fieldTest) };
}

const accepted = (title: string, anchors: string[] = []): CandidateMission =>
  ({ missionKey: "m", title, priority: "high", riskCategory: "critical_journey", anchors }) as unknown as CandidateMission;

describe("a label is not an action when it is a key, the page's furniture, or only a door", () => {
  it.each([
    ["a keyboard shortcut in the label", ["Open Ctrl+O", "Search ⌘ K", "Help ?"]],
    ["the page's own furniture", ["Open Menu Icon", "Toggle theme", "Skip to Content", "Send feedback", "Search Icon"]],
    ["doors that name no action", ["Start free trial", "Create new account", "Sign up with Google", "Try Web App", "Open Source"]],
  ])("%s", (_why, controls) => {
    const p = product(controls);
    expect(primaryCallToAction(p.fieldTest, p.screen, p.corpus)).toBeNull();
  });

  it("the first label that IS something a person does still wins, and is where they start", () => {
    const p = product(["Open Ctrl+O", "Skip to Content", "Start free trial", "Draw your first sketch", "Pricing"]);
    expect(primaryCallToAction(p.fieldTest, p.screen, p.corpus)).toEqual({ mainAction: "draw your first sketch", startsAt: "Draw your first sketch", from: "primary-cta" });
  });

  it("a label in capitals is lowered whole; the product's own short name keeps its capital", () => {
    const p = product(["SHARE WITH FRIENDS"]);
    expect(primaryCallToAction(p.fieldTest, p.screen, p.corpus)?.mainAction).toBe("share with friends");
    const q = product(["Build on Inkpond"]);
    expect(primaryCallToAction(q.fieldTest, q.screen, q.corpus)?.mainAction).toBe("build on Inkpond");
  });
});

describe("a heading", () => {
  it("with a separator is a page title in parts, never an action taken whole", () => {
    const p = product([], { h1: "Search - Inkpond", title: "Search - Inkpond" });
    expect(headingAction(p.fieldTest, p.screen, p.corpus)).toBeNull();
  });

  it("whose product name is really the slogan does not keep every word in capitals", () => {
    const p = product([], { h1: "Draw and Share Your First Sketch", name: "Inkpond — Draw and Share Your First Sketch" });
    expect(headingAction(p.fieldTest, p.screen, p.corpus)?.mainAction).toBe("draw and share your first sketch");
  });
});

describe("where a newcomer starts, when nothing better named it", () => {
  const start = (controls: string[], kind: Parameters<typeof coreHintLadder>[4] = "website") => {
    const p = product(controls);
    return coreHintLadder(null, [], p.map, p.corpus, kind).find((h) => h.from === "first-button")?.startsAt ?? null;
  };

  it.each([
    [["Skip to Content", "Products", "Docs"]],
    [["Open Ctrl+O", "Ctrl K"]],
    [["somebody@inkpond.example", "Signing in…"]],
    [["◆ LEVELS 0 / 7", "LIVE"]],
    [["Produits", "a card someone pinned", "Pinned account"]],
    [["Toggle theme", "Switch to light theme", "Send feedback"]],
  ])("never the first control whatever it is: %j", (controls) => {
    expect(start(controls)).toBeNull();
  });

  it.each([
    [["Skip to Content", "Get started"], "Get started"],
    [["Products", "Launch app"], "Launch app"],
    [["Open Ctrl+O", "Play Tutorial"], "Play Tutorial"],
    [["Docs", "Start free trial"], "Start free trial"],
  ])("a door or something a person does: %j", (controls, want) => {
    expect(start(controls)).toBe(want);
  });

  it("a control that shares a word with the kind's own action (a dapp's Connect wallet), but never with the sentence that fits anything", () => {
    expect(start(["Switch to light theme", "Connect Wallet"], "wallet_dapp")).toBe("Connect Wallet");
    // "do the main thing this product is for" shares "product" with a nav item: that is not where it starts
    expect(start(["Product", "Products"])).toBeNull();
  });

  it("with no starting point the mission still passes the gate, and says nothing false about where to begin", () => {
    const p = product(["Skip to Content", "Open Ctrl+O", "Produits"]);
    const core = addCoreMission({ map: p.map, productUrl: URL_, scope: p.scope, corpus: p.corpus, accepted: [], modelHint: null });
    expect(core).not.toBeNull();
    expect(core!.hint).toEqual({ mainAction: GENERIC_ACTION, startsAt: null, from: "generic" });
    expect(core!.mission.instructions).not.toContain("starting from");
    expect(core!.report.ok).toBe(true);
  });
});

describe("the action an accepted mission's title names", () => {
  it.each([
    ["Build a paper kite and verify it appears in the gallery", "build a paper kite"],
    ["Build a kite, reload the page, and report whether it is still there", "build a kite"],
    ["First-time visitor searches the library for a book about kites", "search the library for a book about kites"],
    ["First-time visitor adds a note to the shared board", "add a note to the shared board"],
    ["First-time user uses the big map to reach a far island", "use the big map to reach a far island"],
    ["Complete the Harbour Welcome", "complete the harbour welcome"],
    ["Apply a colour filter on the Spring Kites shelf and report the new count", "apply a colour filter on the Spring Kites shelf"],
    ["Explore Harbour Section Stories", "explore harbour section stories"],
    ["Follow the install guide end-to-end as a first-time visitor", "follow the install guide"],
    ["Sign up and create your first sketch as a brand-new user", "sign up and create your first sketch"],
  ])("%s → %s", (title, want) => {
    expect(actionFromTitle(title, "Inkpond")).toBe(want);
  });

  it.each([
    "Reach core experience and have a real exchange",
    "Complete the primary flow in inkpond.example (Part 2)",
    "Reach the target and have a real exchange",
    "Complete the founder's journey on inkpond.example end to end",
    "Complete the account step and prove the result",
    "Reach the main screen of inkpond.example as a first-time user",
    "Verify the landing page promise is clear to a newcomer",
    "Homepage hero clarity",
    "First-time visitor: landing to plans journey",
  ])("names no action: %s", (title) => {
    expect(actionFromTitle(title, "Inkpond")).toBeNull();
  });

  it("an anchor is a starting point only when it is where that action starts", () => {
    const p = product(["Pick a pen & start drawing!", "Country", "Layers"]);
    const from = (title: string, anchors: string[]) => coreHintLadder(null, [accepted(title, anchors)], p.map, p.corpus)[0];
    expect(from("Draw a first shape", ["Pick a pen & start drawing!"])).toEqual({ mainAction: "draw a first shape", startsAt: "Pick a pen & start drawing!", from: "accepted-mission" });
    // merely something Sage saw: "starting from “Country”" for a sketch sends a tester nowhere
    expect(from("Draw a first shape", ["Country", "Layers"])).toEqual({ mainAction: "draw a first shape", startsAt: null, from: "accepted-mission" });
  });

  it("a title that names nothing is passed over for the next one, then for the sentence that fits anything", () => {
    const p = product(["Produits"]);
    const ladder = coreHintLadder(null, [accepted("Reach core experience and have a real exchange"), accepted("Verify hero clarity")], p.map, p.corpus);
    expect(ladder).toEqual([{ mainAction: GENERIC_ACTION, startsAt: null, from: "generic" }]);
  });
});
