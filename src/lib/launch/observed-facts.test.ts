import { describe, it, expect } from "vitest";
import { deriveObservations, decisiveFacts, factIndex, parseTrigger, stateDigest, publicObservationView, deriveActionOutcomes } from "./observed-facts";
import type { FieldTestSummary, FieldTestState, VisionObservation } from "./schemas";

const state = (over: Partial<FieldTestState>): FieldTestState => ({
  trigger: "initial load", screenshot: null, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 0, url: "https://p.test/", ...over,
});
const summary = (over: Partial<FieldTestSummary>): FieldTestSummary => ({
  ran: true, startUrl: "https://p.test/", mode: "interactive", pages: [], states: [], classification: null, limitation: null, durationMs: 10, ...over,
});

describe("Eyes V2 — deterministic action-grounded facts", () => {
  it("field-test states become SEEN, decisive DOM facts; transitions are captured with a safe verb", () => {
    const ft = summary({
      states: [
        state({ trigger: "initial load", url: "https://p.test/", visibleTextExcerpt: "Welcome. Press start.", notableElements: [{ tag: "button", text: "Start", role: "button" }] }),
        state({ trigger: "clicked 'Start'", url: "https://p.test/play", visibleTextExcerpt: "The world. Talk to Yara.", notableElements: [{ tag: "button", text: "Talk to Yara", role: "button" }], pixelDeltaPct: 40 }),
      ],
    });
    const set = deriveObservations(ft);
    const seen = decisiveFacts(set);
    expect(seen.every((f) => f.grounding === "seen" && f.decisive)).toBe(true);
    expect(seen.some((f) => f.elementName === "Start")).toBe(true);
    expect(seen.some((f) => f.elementName === "Talk to Yara")).toBe(true);
    expect(set.transitions).toHaveLength(1);
    const t = set.transitions[0];
    expect(t.verb).toBe("click");
    expect(t.locator.accessibleName).toBe("Start");
    expect(t.observableChange).toBe(true);
    expect(t.safeClassification).toBe("safe");
    expect(t.addedTexts.some((x) => /Talk to Yara/.test(x))).toBe(true);
  });

  it("VISION exact text CANNOT be invented — text absent from the captured source is dropped", () => {
    const vo: VisionObservation = {
      stateIndex: 0, trigger: "initial load", sceneDescription: "A game menu.",
      visibleText: ["Start", "SECRET ADMIN PANEL"], // "Start" is real; the second was never captured
      uiElements: [{ label: "Start", kind: "button" }], productTypeSignals: ["game"], audienceSignals: [], qualityIssues: [],
    };
    const ft = summary({
      states: [state({ visibleTextExcerpt: "Menu", notableElements: [{ tag: "button", text: "Start", role: "button" }] })],
      visionObservations: [vo],
    });
    const set = deriveObservations(ft);
    const vision = set.facts.filter((f) => f.source === "vision");
    expect(vision).toHaveLength(1);
    expect(vision[0].visibleTexts).toContain("Start");
    expect(vision[0].visibleTexts.join(" ")).not.toMatch(/SECRET ADMIN PANEL/); // invented text dropped
  });

  it("INFERRED (vision) facts can never be decisive anchors", () => {
    const ft = summary({
      states: [state({ visibleTextExcerpt: "Dashboard", notableElements: [{ tag: "h1", text: "Dashboard", role: "" }] })],
      visionObservations: [{ stateIndex: 0, trigger: "initial load", sceneDescription: "A dashboard.", visibleText: ["Dashboard"], uiElements: [], productTypeSignals: ["saas"], audienceSignals: [], qualityIssues: [] }],
    });
    const set = deriveObservations(ft);
    expect(set.facts.some((f) => f.source === "vision")).toBe(true);
    expect(decisiveFacts(set).every((f) => f.source !== "vision")).toBe(true); // vision excluded from decisive
  });

  it("DUPLICATE facts canonicalize to one id; the SAME text on a different state is a DISTINCT fact", () => {
    const s1 = state({ url: "https://p.test/a", visibleTextExcerpt: "A", notableElements: [{ tag: "button", text: "Save", role: "button" }] });
    const s2 = state({ url: "https://p.test/a", visibleTextExcerpt: "A", notableElements: [{ tag: "button", text: "Save", role: "button" }] }); // identical → dedup
    const s3 = state({ url: "https://p.test/b", visibleTextExcerpt: "B", notableElements: [{ tag: "button", text: "Save", role: "button" }] }); // same text, different page/state
    const set = deriveObservations(summary({ states: [s1, s2, s3] }));
    const saves = set.facts.filter((f) => f.elementName === "Save");
    expect(saves).toHaveLength(2); // s1==s2 canonicalized; s3 distinct (page/state in the hash)
    expect(new Set(saves.map((f) => f.id)).size).toBe(2);
  });

  it("IDs + digests are DETERMINISTIC (same input → same ids, run to run)", () => {
    const ft = summary({ states: [state({ visibleTextExcerpt: "X", notableElements: [{ tag: "a", text: "Docs", role: "link" }] })] });
    const a = deriveObservations(ft, 1);
    const b = deriveObservations(ft, 99); // captureVersion differs, but it is NOT hashed
    expect(a.facts.map((f) => f.id)).toEqual(b.facts.map((f) => f.id));
    expect(a.digest).toBe(b.digest);
  });

  it("factIndex rejects a missing id (a mission that cites a non-existent fact cannot be grounded)", () => {
    const set = deriveObservations(summary({ states: [state({ notableElements: [{ tag: "button", text: "Go", role: "button" }] })] }));
    const idx = factIndex(set);
    expect(idx.facts.get(set.facts[0].id)).toBeDefined();
    expect(idx.facts.get("deadbeefdeadbeefdeadbeef")).toBeUndefined();
  });

  it("OLD artifacts remain readable: a ran=false summary, or one with no vision, derives cleanly", () => {
    expect(deriveObservations(summary({ ran: false })).facts).toHaveLength(0);
    expect(deriveObservations(null).facts).toHaveLength(0);
    const noVision = deriveObservations(summary({ pages: [{ url: "https://p.test/", title: "Home", h1: "Welcome", ctas: ["Sign up"], forms: [], consoleErrors: [], brokenRequests: [], jsOnly: false, screenshot: null }], mode: "static" }));
    expect(noVision.facts.some((f) => f.elementName === "Sign up")).toBe(true);
  });

  it("parseTrigger maps triggers to safe verbs deterministically", () => {
    expect(parseTrigger("initial load")).toEqual({ verb: "load" });
    expect(parseTrigger("waited out loading")).toEqual({ verb: "wait" });
    expect(parseTrigger("clicked 'Start'")).toEqual({ verb: "click", name: "Start" });
    expect(parseTrigger("pressed Space")).toEqual({ verb: "press", name: "Space" });
    expect(parseTrigger("scrolled down")).toEqual({ verb: "scroll" });
  });

  it("deriveActionOutcomes ties a safe action to its state change + facts (seen; never fabricated significance)", () => {
    const ft = summary({
      states: [
        state({ trigger: "initial load", visibleTextExcerpt: "Menu", notableElements: [{ tag: "button", text: "Start", role: "button" }] }),
        state({ trigger: "clicked 'Start'", url: "https://p.test/play", visibleTextExcerpt: "The world", notableElements: [{ tag: "button", text: "Talk to Yara", role: "button" }], pixelDeltaPct: 40 }),
      ],
    });
    const set = deriveObservations(ft);
    const outcomes = deriveActionOutcomes(set);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].safeAction).toBe("click");
    expect(outcomes[0].observedControl?.name).toBe("Start");
    expect(outcomes[0].grounding).toBe("seen");
    expect(outcomes[0].whyItMightMatter).toBeNull(); // significance is never fabricated here
    expect(outcomes[0].factIds.length).toBeGreaterThan(0); // references the after-state's seen facts
    // every referenced fact id actually exists + is decisive/seen
    const idx = factIndex(set);
    for (const id of outcomes[0].factIds) expect(idx.facts.get(id)?.grounding).toBe("seen");
  });

  it("publicObservationView leaks NO observed text — only counts, digest, and ids", () => {
    const ft = summary({ states: [state({ visibleTextExcerpt: "TOP SECRET INTERNAL MEMO", notableElements: [{ tag: "button", text: "Confidential Action", role: "button" }] })] });
    const set = deriveObservations(ft);
    const view = publicObservationView(set);
    const blob = JSON.stringify(view);
    expect(blob).not.toMatch(/TOP SECRET INTERNAL MEMO/);
    expect(blob).not.toMatch(/Confidential Action/);
    expect(view.seenFacts).toBeGreaterThan(0);
    expect(view.digest).toBe(set.digest);
    expect(view.factIds).toEqual(set.facts.map((f) => f.id).sort());
  });

  it("stateDigest is stable + distinguishes different states", () => {
    const a = stateDigest({ url: "u", visibleTextExcerpt: "hello world", notableElements: [] });
    expect(a).toBe(stateDigest({ url: "u", visibleTextExcerpt: "hello   world", notableElements: [] })); // whitespace-normalized
    expect(a).not.toBe(stateDigest({ url: "u2", visibleTextExcerpt: "hello world", notableElements: [] }));
  });
});
