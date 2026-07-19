import { describe, expect, it } from "vitest";
import type { FieldTestSummary } from "@/lib/launch/schemas";
import { distillPrivateKey, verifyAgainstKey, normObs, observationBar, OBS_BAR, type ObservationSignals } from "./observation-verify";

// A yara-like interactive field test: 3 states + vision frames. The PUBLIC card strings are the plan
// prose a tester can read; the PRIVATE observations are what Sage saw and the card never showed.
const fieldTest: FieldTestSummary = {
  ran: true,
  startUrl: "https://yara.example/",
  mode: "interactive",
  pages: [],
  states: [
    { trigger: "initial load", screenshot: "/s/0", visibleTextExcerpt: "make a wish\nthe lantern drifts upward", notableElements: [{ tag: "button", text: "light the lantern", role: "button" }], pixelDeltaPct: 100, url: "https://yara.example/" },
    { trigger: "explored '+'", screenshot: "/s/1", visibleTextExcerpt: "a koi pond ripples in moonlight", notableElements: [{ tag: "div", text: "cast a stone", role: "button" }], pixelDeltaPct: 40, url: "https://yara.example/" },
    { trigger: "pressed space", screenshot: "/s/2", visibleTextExcerpt: "the cherry blossoms fall", notableElements: [], pixelDeltaPct: 30, url: "https://yara.example/" },
  ],
  classification: "Interactive app · 3 states",
  visionObservations: [
    { stateIndex: 0, trigger: "initial load", sceneDescription: "A lantern floats over a still lake at dusk", visibleText: ["make a wish"], uiElements: [{ label: "light the lantern", kind: "button" }], productTypeSignals: ["ambient game"], audienceSignals: ["calm seekers"], qualityIssues: [] },
    { stateIndex: 1, trigger: "explored '+'", sceneDescription: "Ripples spread across a moonlit koi pond", visibleText: ["cast a stone"], uiElements: [], productTypeSignals: [], audienceSignals: [], qualityIssues: [] },
  ],
  limitation: null,
  durationMs: 10,
};

// What the tester COULD read off the mission plan/card/board — must be structurally excluded.
const publicStrings = [
  "Validate the first-session feel of Yara",
  "Arrive on the page and describe the opening scene",
  "Confirm the experience evokes calm",
  "Yara", // product name, rendered everywhere
];

describe("distillPrivateKey — structural parrot exclusion + source tagging", () => {
  const key = distillPrivateKey(fieldTest, publicStrings);

  it("keeps private observations Sage saw but the card never showed", () => {
    const texts = key.observations.map((o) => o.text);
    expect(texts).toContain("make a wish");
    expect(texts).toContain("light the lantern");
    expect(texts).toContain("a koi pond ripples in moonlight");
  });

  it("EXCLUDES any string readable off the public card (parrot-zero is structural)", () => {
    const blob = key.observations.map((o) => o.text).join(" | ");
    expect(blob).not.toContain("evokes calm");
    expect(blob).not.toContain("opening scene");
    // "yara" appears only inside public strings → not a standalone private observation
    expect(key.observations.some((o) => o.text === "yara")).toBe(false);
  });

  it("tags observations by SOURCE, folding a vision frame into its state (stateIndex)", () => {
    const sources = new Set(key.observations.map((o) => o.source));
    expect(sources.has("state:0")).toBe(true);
    expect(sources.has("state:1")).toBe(true);
    // vision frame 0 folded into state:0, never a separate "vision:0" source
    expect([...sources].every((s) => s.startsWith("state:") || s.startsWith("page:"))).toBe(true);
  });

  it("has a stable digest that changes only when the key content changes", () => {
    expect(key.digest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(distillPrivateKey(fieldTest, publicStrings).digest).toBe(key.digest); // deterministic
    const altered = distillPrivateKey({ ...fieldTest, states: fieldTest.states.slice(0, 1) }, publicStrings);
    expect(altered.digest).not.toBe(key.digest);
  });
});

describe("verifyAgainstKey — genuine vs parrot vs distinct-source counting", () => {
  const key = distillPrivateKey(fieldTest, publicStrings);

  it("a PARROT account (only public-card language) scores ZERO — the exclusion holds end to end", () => {
    const parrot = "I arrived on the page and described the opening scene. The experience evokes calm. Yara is lovely.";
    const m = verifyAgainstKey(parrot, key);
    expect(m.distinctSources).toBe(0);
    expect(m.matchedCount).toBe(0);
  });

  it("a GENUINE account describing 3 different screens scores ≥3 DISTINCT sources", () => {
    const genuine =
      "First I saw 'make a wish' and clicked light the lantern. Then a koi pond ripples in moonlight and I cast a stone. Finally the cherry blossoms fall.";
    const m = verifyAgainstKey(genuine, key);
    expect(m.distinctSources).toBeGreaterThanOrEqual(3);
  });

  it("a GENUINE PARAPHRASE (same screens, own words, NO verbatim quotes) scores ≥3 — the matcher fix", () => {
    // The real-world case the exact-substring matcher failed: a human describes what they saw without
    // quoting Sage's captured strings verbatim. word-overlap credits it; substring alone scored ~1.
    const paraphrase =
      "the very first thing was a wish i got to make, and a lantern i lit up. after that, a pond full of koi rippling under the moonlight where i cast a stone in. right at the end, blossoms off the cherry trees were falling down.";
    const m = verifyAgainstKey(paraphrase, key);
    expect(m.distinctSources).toBeGreaterThanOrEqual(3);
  });

  it("a GENERIC hand-wavy account (no specific observations) stays below the bar — overlap ≠ vagueness", () => {
    const generic =
      "i explored the whole experience, it felt calm and pretty, i saw some nice nature scenes and interacted with a few things here and there.";
    expect(verifyAgainstKey(generic, key).distinctSources).toBeLessThan(3);
  });

  it("a PARAPHRASED parrot (public-card ideas reworded) still scores ZERO — overlap didn't weaken parrot-zero", () => {
    const parrot = "I showed up on the site and captured the very first opening moment; the whole thing gives off a calm, restful vibe.";
    expect(verifyAgainstKey(parrot, key).distinctSources).toBe(0);
  });

  it("three phrases from ONE state count as ONE distinct source (not gameable by padding)", () => {
    // everything here is from state:0 only
    const oneState = "make a wish, light the lantern, the lantern drifts upward — all on the first screen";
    const m = verifyAgainstKey(oneState, key);
    expect(m.matchedCount).toBeGreaterThanOrEqual(2); // several substrings match…
    expect(m.distinctSources).toBe(1); // …but only ONE distinct source
  });

  it("is deterministic and case/punctuation-insensitive", () => {
    const a = "MAKE A WISH!! and then a KOI POND ripples in moonlight.";
    expect(verifyAgainstKey(a, key).distinctSources).toBe(verifyAgainstKey(normObs(a), key).distinctSources);
    expect(verifyAgainstKey(a, key).distinctSources).toBeGreaterThanOrEqual(2);
  });

  it("empty / null account → zero", () => {
    expect(verifyAgainstKey(null, key).distinctSources).toBe(0);
    expect(verifyAgainstKey("", key).matchedCount).toBe(0);
  });
});

describe("observationBar — the fixed 6-condition structure (N-values calibrated in shadow)", () => {
  const pass: ObservationSignals = {
    distinctSources: 3, keyDistinctSources: 6, contradictions: 0, obsConfidence: 0.92, nearDupClear: true, hasHighFraud: false,
  };
  it("passes only when ALL six hold", () => {
    expect(observationBar(pass)).toEqual({ pass: true, reasons: [] });
  });
  it("a single contradiction kills autopay outright, whatever else scores", () => {
    const r = observationBar({ ...pass, contradictions: 1, distinctSources: 9, obsConfidence: 0.99 });
    expect(r.pass).toBe(false);
    expect(r.reasons.some((x) => x.startsWith("contradiction"))).toBe(true);
  });
  it("a thin pinned corpus (campaign ineligible) holds", () => {
    expect(observationBar({ ...pass, keyDistinctSources: 4 }).pass).toBe(false);
  });
  it("fewer than 3 distinct matches holds", () => {
    expect(observationBar({ ...pass, distinctSources: 2 }).reasons.some((x) => x.startsWith("few_matches"))).toBe(true);
  });
  it("confidence below the stricter 0.90 lane holds", () => {
    expect(observationBar({ ...pass, obsConfidence: 0.88 }).pass).toBe(false);
  });
  it("a near-dup or a high-severity fraud signal holds", () => {
    expect(observationBar({ ...pass, nearDupClear: false }).reasons).toContain("near_dup");
    expect(observationBar({ ...pass, hasHighFraud: true }).reasons).toContain("high_fraud");
  });
  it("the fixed structure exposes calibratable N-values", () => {
    expect(OBS_BAR).toMatchObject({ minDistinctMatches: 3, minKeySources: 5, minConfidence: 0.9 });
  });
});
