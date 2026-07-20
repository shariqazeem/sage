import { describe, expect, it } from "vitest";
import {
  parseVisionJson,
  aggregateVisionSignals,
  visionCategory,
  describeStatesWithVision,
  selectStatesForVision,
} from "./vision";
import type { FieldTestState, VisionObservation } from "./schemas";

/**
 * The vision pass is untrusted-input processing: a model's raw text becomes structured
 * observations only after total, capped coercion; the orchestration is failure-isolated
 * and capped; and the map derivation must be byte-identical when vision is absent.
 */

/* ─────────────────────────── canned-response parsing ─────────────────────── */

describe("parseVisionJson", () => {
  it("parses a clean strict-JSON vision response", () => {
    const content = JSON.stringify({
      sceneDescription: "An anime-styled ambient world titled Yara",
      visibleText: ["Yara", "make a wish"],
      uiElements: [{ label: "+", kind: "button" }],
      productTypeSignals: ["interactive game", "anime art"],
      audienceSignals: ["casual players"],
      qualityIssues: [],
    });
    const o = parseVisionJson(content, { stateIndex: 0, trigger: "initial load" });
    expect(o).toBeTruthy();
    expect(o!.stateIndex).toBe(0);
    expect(o!.trigger).toBe("initial load");
    expect(o!.sceneDescription).toContain("Yara");
    expect(o!.productTypeSignals).toContain("interactive game");
    expect(o!.uiElements[0]).toEqual({ label: "+", kind: "button" });
  });

  it("strips ```json fences and surrounding prose", () => {
    const o = parseVisionJson('Here is what I see:\n```json\n{"sceneDescription":"a start menu","productTypeSignals":["game"]}\n```', { stateIndex: 1, trigger: "x" });
    expect(o?.sceneDescription).toBe("a start menu");
    expect(o?.productTypeSignals).toEqual(["game"]);
  });

  it("coerces an unknown element kind to 'other' and caps arrays at 8", () => {
    const o = parseVisionJson(
      JSON.stringify({
        sceneDescription: "s",
        uiElements: [{ label: "a", kind: "weird" }, { label: "", kind: "button" }],
        visibleText: Array.from({ length: 20 }, (_, i) => `t${i}`),
      }),
      { stateIndex: 0, trigger: "x" },
    );
    expect(o!.uiElements).toEqual([{ label: "a", kind: "other" }]); // blank-label element dropped
    expect(o!.visibleText).toHaveLength(8);
  });

  it("accepts alternative field names (scene/text/elements/productType/audience/issues)", () => {
    const o = parseVisionJson(JSON.stringify({ scene: "s", text: ["a"], productType: ["landing page"] }), { stateIndex: 0, trigger: "x" });
    expect(o?.sceneDescription).toBe("s");
    expect(o?.visibleText).toEqual(["a"]);
    expect(o?.productTypeSignals).toEqual(["landing page"]);
  });

  it("returns null for non-JSON, empty, or fully-empty observations", () => {
    expect(parseVisionJson("the model refused to answer", { stateIndex: 0, trigger: "x" })).toBeNull();
    expect(parseVisionJson("", { stateIndex: 0, trigger: "x" })).toBeNull();
    expect(parseVisionJson(JSON.stringify({ sceneDescription: "", visibleText: [], productTypeSignals: [] }), { stateIndex: 0, trigger: "x" })).toBeNull();
  });
});

/* ──────────────────────── aggregation + categorisation ───────────────────── */

const mk = (over: Partial<VisionObservation>): VisionObservation => ({
  stateIndex: 0, trigger: "t", sceneDescription: "", visibleText: [], uiElements: [],
  productTypeSignals: [], audienceSignals: [], qualityIssues: [], ...over,
});

describe("aggregateVisionSignals + visionCategory", () => {
  it("ranks signals by frequency and dedupes case-insensitively", () => {
    const agg = aggregateVisionSignals([mk({ productTypeSignals: ["Interactive Game", "anime art"] }), mk({ productTypeSignals: ["interactive game"] })]);
    expect(agg.productTypeSignals[0].toLowerCase()).toBe("interactive game"); // 2 hits → ranked first
    expect(agg.productTypeSignals).toHaveLength(2);
  });

  it("derives 'interactive game' and appends an art style when present", () => {
    expect(visionCategory(aggregateVisionSignals([mk({ productTypeSignals: ["interactive game"] })]))).toBe("interactive game");
    expect(visionCategory(aggregateVisionSignals([mk({ productTypeSignals: ["interactive game", "anime art"] })]))).toMatch(/interactive game, anime-styled/i);
  });

  it("maps SaaS / docs signals and returns null with no signals", () => {
    expect(visionCategory(aggregateVisionSignals([mk({ productTypeSignals: ["analytics dashboard"] })]))).toBe("SaaS app");
    expect(visionCategory(aggregateVisionSignals([]))).toBeNull();
  });
});

/* ─────────────── orchestration (via the describeImage test seam) ─────────── */

const state = (i: number, screenshot: string | null = `/api/field-tests/x/${i}`): FieldTestState => ({
  trigger: `explored ${i}`, screenshot, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 10, url: "https://g/",
});
const obsFor = (i: number): VisionObservation => mk({ stateIndex: i, trigger: `explored ${i}`, sceneDescription: `scene ${i}`, productTypeSignals: ["interactive game"] });

describe("describeStatesWithVision", () => {
  it("describes up to maxImages screenshots, in order", async () => {
    const seen: number[] = [];
    const out = await describeStatesWithVision(Array.from({ length: 9 }, (_, i) => state(i)), "/tmp/x", {
      maxImages: 6,
      describeImage: async (_s, i) => {
        seen.push(i);
        return { observation: obsFor(i), promptTokens: 1000 };
      },
    });
    expect(out).toHaveLength(6);
    expect(seen).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("is failure-isolated: a per-image failure is skipped, the rest survive", async () => {
    const out = await describeStatesWithVision([state(0), state(1), state(2)], "/tmp/x", {
      describeImage: async (_s, i) => {
        if (i === 1) throw new Error("vision boom");
        return { observation: obsFor(i), promptTokens: 500 };
      },
    });
    expect(out.map((o) => o.stateIndex)).toEqual([0, 2]);
  });

  it("skips states without a screenshot and returns [] when none have one", async () => {
    const withOne = await describeStatesWithVision([state(0, null), state(1)], "/tmp/x", {
      describeImage: async (_s, i) => ({ observation: obsFor(i), promptTokens: 0 }),
    });
    expect(withOne.map((o) => o.stateIndex)).toEqual([1]);

    const none = await describeStatesWithVision([state(0, null), state(1, null)], "/tmp/x", {
      describeImage: async (_s, i) => ({ observation: obsFor(i), promptTokens: 0 }),
    });
    expect(none).toEqual([]);
  });
});

describe("selectStatesForVision (P21 — describe the RICHEST states, not the first N)", () => {
  const rich = (i: number, over: Partial<FieldTestState> = {}): FieldTestState => ({
    trigger: `s${i}`, screenshot: `/api/field-tests/x/${i}`, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 5, url: "https://g/", ...over,
  });

  it("returns all states when they fit under the cap, in index order", () => {
    const out = selectStatesForVision([rich(0), rich(1), rich(2)], 6);
    expect(out.map((x) => x.i)).toEqual([0, 1, 2]);
  });

  it("over the cap: keeps state 0 (the anchor) + the richest others, preserving true indices", () => {
    // 0 = sparse anchor; 1..3 sparse; 4 & 5 are RICH (many elements, big delta) but come late.
    const states = [
      rich(0),
      rich(1), rich(2), rich(3),
      rich(4, { notableElements: Array.from({ length: 9 }, (_, k) => ({ tag: "label", text: `Stroke${k}`, role: "" })), pixelDeltaPct: 90 }),
      rich(5, { notableElements: Array.from({ length: 7 }, (_, k) => ({ tag: "label", text: `Fill${k}`, role: "" })), pixelDeltaPct: 80 }),
    ];
    const out = selectStatesForVision(states, 3).map((x) => x.i);
    // the two rich late states MUST be looked at; state 0 is always kept; ascending order preserved.
    expect(out).toContain(4);
    expect(out).toContain(5);
    expect(out).toContain(0);
    expect(out).toEqual([...out].sort((a, b) => a - b));
    expect(out).toHaveLength(3);
  });

  it("drops states without a screenshot before selecting", () => {
    const out = selectStatesForVision([rich(0, { screenshot: null }), rich(1), rich(2)], 6);
    expect(out.map((x) => x.i)).toEqual([1, 2]);
  });
});
