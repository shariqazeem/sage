import { describe, expect, it } from "vitest";
import type { FieldTestSummary } from "@/lib/launch/schemas";
import { yaraFieldTest, yaraPublicStrings, excalidrawFieldTest, excalidrawPublicStrings } from "./observation-fixtures";
import {
  distillPrivateKey,
  verifyAgainstKey,
  normObs,
  observationBar,
  legacyObservationBar,
  validateContradictions,
  OBS_BAR,
  type ObservationSignals,
} from "./observation-verify";

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

describe("observationBar — deterministic-primary gate (2b: confidence deleted, veto must be validated)", () => {
  const pass: ObservationSignals = {
    distinctSources: 3, keyDistinctSources: 6, vetoFired: false, nearDupClear: true, hasHighFraud: false,
  };
  it("passes when every arithmetic condition holds and no veto fired", () => {
    expect(observationBar(pass)).toEqual({ pass: true, reasons: [] });
  });
  it("a VALIDATED veto kills autopay outright, whatever else scores", () => {
    const r = observationBar({ ...pass, vetoFired: true, distinctSources: 9 });
    expect(r.pass).toBe(false);
    expect(r.reasons).toContain("contradiction");
  });
  it("a thin pinned corpus (campaign ineligible) holds", () => {
    expect(observationBar({ ...pass, keyDistinctSources: 4 }).pass).toBe(false);
  });
  it("fewer than 3 distinct matches holds", () => {
    expect(observationBar({ ...pass, distinctSources: 2 }).reasons.some((x) => x.startsWith("few_matches"))).toBe(true);
  });
  it("a near-dup or a high-severity fraud signal holds", () => {
    expect(observationBar({ ...pass, nearDupClear: false }).reasons).toContain("near_dup");
    expect(observationBar({ ...pass, hasHighFraud: true }).reasons).toContain("high_fraud");
  });
  it("confidence is NOT a bar input — it isn't even on the signals type (the 0.90 gate is deleted)", () => {
    expect(OBS_BAR).toMatchObject({ minDistinctMatches: 3, minKeySources: 5 });
    expect((OBS_BAR as Record<string, unknown>).minConfidence).toBeUndefined();
  });
});

describe("P20.0 anti-guess — generic/category vocab can't seed matches; a paraphrased parrot ~zeroes", () => {
  // A shallow, generic-dominated field test (the excalidraw failure class): every screen is category
  // signals + a persistent toolbar + generic single words, with ONE firsthand specific per screen.
  const shallowTool: FieldTestSummary = {
    ran: true, startUrl: "https://tool.example/", mode: "interactive", pages: [],
    states: [
      { trigger: "s0", screenshot: "/t/0", visibleTextExcerpt: "menu\ntools", notableElements: [{ tag: "button", text: "main toolbar", role: "button" }], pixelDeltaPct: 50, url: "https://tool.example/" },
      { trigger: "s1", screenshot: "/t/1", visibleTextExcerpt: "menu\ntools", notableElements: [{ tag: "button", text: "main toolbar", role: "button" }], pixelDeltaPct: 40, url: "https://tool.example/" },
      { trigger: "s2", screenshot: "/t/2", visibleTextExcerpt: "menu\ntools", notableElements: [{ tag: "button", text: "main toolbar", role: "button" }], pixelDeltaPct: 40, url: "https://tool.example/" },
    ],
    classification: "Interactive app · 3 states",
    visionObservations: [
      { stateIndex: 0, trigger: "s0", sceneDescription: "a crimson anchor buoy bobbing in a harbor preview", visibleText: [], uiElements: [{ label: "main toolbar", kind: "button" }], productTypeSignals: ["diagramming tool", "whiteboard software", "saas dashboard"], audienceSignals: ["designers", "developers", "general users"], qualityIssues: [] },
      { stateIndex: 1, trigger: "s1", sceneDescription: "a frostbite gradient panel sliding open on the left", visibleText: [], uiElements: [{ label: "main toolbar", kind: "button" }], productTypeSignals: ["diagramming tool", "whiteboard software"], audienceSignals: ["designers", "developers"], qualityIssues: [] },
      { stateIndex: 2, trigger: "s2", sceneDescription: "a dotted marquee wrapping the selected widget cluster", visibleText: [], uiElements: [{ label: "main toolbar", kind: "button" }], productTypeSignals: ["diagramming tool", "saas dashboard"], audienceSignals: ["designers", "general users"], qualityIssues: [] },
    ],
    limitation: null, durationMs: 10,
  };
  const publicStrings = ["Verify the first drawing", "the canvas", "the tool"];
  const key = distillPrivateKey(shallowTool, publicStrings);

  it("excludes category/single-word terms; COLLAPSES a persistent generic to one source (no inflation)", () => {
    const blob = key.observations.map((o) => o.text).join(" | ");
    expect(blob).not.toContain("diagramming tool"); // productType signals excluded
    expect(blob).not.toContain("designers"); // audience signals excluded
    expect(key.observations.some((o) => o.text === "menu" || o.text === "tools")).toBe(false); // single-word
    // "main toolbar" recurs across 3 states → COLLAPSED to a single occurrence (P21: kept, not dropped, so
    // rich-but-persistent UI survives) — it can therefore seed AT MOST one distinct source, never three.
    const toolbarSources = new Set(key.observations.filter((o) => o.text === "main toolbar").map((o) => o.source));
    expect(toolbarSources.size).toBeLessThanOrEqual(1);
  });
  it("a GENERIC GUESS (product category + common UI, no firsthand) scores BELOW the floor", () => {
    const guess = "It's a diagramming tool and whiteboard software with a main toolbar, menus, tools, and shapes for designers and developers.";
    expect(verifyAgainstKey(guess, key).distinctSources).toBeLessThan(3);
  });
  it("a GENUINE account naming the firsthand specifics still clears (≥3)", () => {
    const genuine = "I saw a crimson anchor buoy bobbing in a harbor preview, then a frostbite gradient panel sliding open, and a dotted marquee wrapping the selected widget cluster.";
    expect(verifyAgainstKey(genuine, key).distinctSources).toBeGreaterThanOrEqual(3);
  });
  it("a PARAPHRASED PARROT (mission card reworded) scores ~zero on the real yara + excalidraw shapes", () => {
    const yk = distillPrivateKey(yaraFieldTest, yaraPublicStrings);
    const ek = distillPrivateKey(excalidrawFieldTest, excalidrawPublicStrings);
    const pYara = "I checked how the very first session of the product feels; I reached the opening screen and took in the whole thing, and it really does give a calm, wonder-filled impression.";
    const pEx = "I confirmed the rectangle tool properly begins a drawing action when used on the drawing surface of the app.";
    expect(verifyAgainstKey(pYara, yk).distinctSources).toBeLessThan(3);
    expect(verifyAgainstKey(pEx, ek).distinctSources).toBeLessThan(3);
  });
  it("RETRY-GRINDING: three increasingly card-adjacent attempts each stay below the floor (judged fresh)", () => {
    const yk = distillPrivateKey(yaraFieldTest, yaraPublicStrings);
    const attempts = [
      "I looked at the first session experience of the product.",
      "I looked at the first session, arrived on the opening screen, described the experience.",
      "I arrived on the opening screen, described what I experience, and confirmed it evokes calm and wonder — the whole first session.",
    ];
    for (const a of attempts) expect(verifyAgainstKey(a, yk).distinctSources).toBeLessThan(3);
  });
});

describe("P21 corpus completeness — deep-exploration content survives + is granularly matchable", () => {
  // A drawing app (the excalidraw class): a PERSISTENT properties panel repeated across states, and a
  // context menu whose items land on separate lines (what the newline-preserving field-test excerpt now
  // captures). This is the shape P21's deep explorer produces; the distiller must keep it AND make it
  // matchable at a tester's granularity.
  const drawingApp: FieldTestSummary = {
    ran: true, startUrl: "https://draw.example/", mode: "interactive", pages: [],
    states: [
      { trigger: "initial", screenshot: "/d/0", visibleTextExcerpt: "your drawings are saved in your browser storage\nsave your work to a file regularly to avoid losing it", notableElements: [], pixelDeltaPct: 50, url: "https://draw.example/" },
      { trigger: "drew a shape", screenshot: "/d/1", visibleTextExcerpt: "selected shape actions\nstroke width\nstroke style\nopacity slider", notableElements: [{ tag: "label", text: "selected shape actions", role: "" }], pixelDeltaPct: 80, url: "https://draw.example/" },
      { trigger: "drew again", screenshot: "/d/2", visibleTextExcerpt: "selected shape actions\nstroke width\nstroke style\nopacity slider", notableElements: [], pixelDeltaPct: 5, url: "https://draw.example/" },
      { trigger: "moved it", screenshot: "/d/3", visibleTextExcerpt: "selected shape actions\nstroke width\nstroke style\nopacity slider", notableElements: [], pixelDeltaPct: 5, url: "https://draw.example/" },
      { trigger: "context menu", screenshot: "/d/4", visibleTextExcerpt: "select all\ntoggle grid\nsnap to objects\narrow binding\nzen mode", notableElements: [], pixelDeltaPct: 60, url: "https://draw.example/" },
    ],
    classification: null, limitation: null, durationMs: 10,
  };
  const publicStrings = ["Draw a shape on the canvas", "the app", "the drawing surface"];
  const key = distillPrivateKey(drawingApp, publicStrings);

  it("newline-separated menu/panel items become DISTINCT observations, not one unmatchable blob", () => {
    const texts = key.observations.map((o) => o.text);
    for (const item of ["select all", "toggle grid", "snap to objects", "zen mode", "stroke width", "stroke style"]) {
      expect(texts).toContain(item);
    }
  });

  it("a persistent panel repeated across 3+ states is COLLAPSED to one source (kept, not deleted)", () => {
    const panelSources = new Set(key.observations.filter((o) => o.text === "selected shape actions").map((o) => o.source));
    expect(panelSources.size).toBe(1); // one credit for the persistent panel — rich content survives, no inflation
  });

  it("a GENUINE tester (storage warning + properties panel + context menu) clears ≥3 distinct sources", () => {
    const genuine =
      "It warned that my drawings are saved in browser storage. I drew a shape and a selected shape actions panel appeared where I set the stroke width and dragged the opacity slider. Right-clicking showed select all, toggle grid, and zen mode.";
    expect(verifyAgainstKey(genuine, key).distinctSources).toBeGreaterThanOrEqual(3);
  });

  it("a CATEGORY guesser (no firsthand menu/panel items) stays below the bar", () => {
    const guess = "It's a drawing and diagramming tool with a canvas, some shapes, and a toolbar where you can draw things.";
    expect(verifyAgainstKey(guess, key).distinctSources).toBeLessThan(3);
  });
});

describe("P23-B phrase-split — long vision prose becomes matchable, parrot/guesser still zero", () => {
  // A yara-class VISUAL product: the corpus is dominated by long vision scene-descriptions (11–18 words)
  // that no genuine tester reproduces at 60% overlap — the exact failure the strategy matrix exposed.
  const visualApp: FieldTestSummary = {
    ran: true, startUrl: "https://world.example/", mode: "interactive", pages: [], classification: null, limitation: null, durationMs: 10,
    states: [
      { trigger: "initial", screenshot: "/v/0", visibleTextExcerpt: "tap to step inside", notableElements: [], pixelDeltaPct: 90, url: "https://world.example/" },
      { trigger: "entered", screenshot: "/v/1", visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 80, url: "https://world.example/" },
      { trigger: "explored", screenshot: "/v/2", visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 70, url: "https://world.example/" },
    ],
    visionObservations: [
      { stateIndex: 0, trigger: "initial", sceneDescription: "a stylized anime illustration of a sunset landscape featuring hills and a pond with floating lanterns", visibleText: [], uiElements: [], productTypeSignals: [], audienceSignals: [], qualityIssues: [] },
      { stateIndex: 1, trigger: "entered", sceneDescription: "a top down 2d grassy garden environment featuring cartoon characters and a stone path with trees", visibleText: [], uiElements: [], productTypeSignals: [], audienceSignals: [], qualityIssues: [] },
      { stateIndex: 2, trigger: "explored", sceneDescription: "a tranquil pixel scene showing a glowing orb over a river with a wooden bridge", visibleText: [], uiElements: [], productTypeSignals: [], audienceSignals: [], qualityIssues: [] },
    ],
  };
  const publicStrings = ["Experience the world", "the product", "the opening screen"];
  const key = distillPrivateKey(visualApp, publicStrings);

  it("splits scene prose into short firsthand phrases (not one unmatchable blob)", () => {
    const texts = key.observations.map((o) => o.text);
    for (const phrase of ["sunset landscape", "floating lanterns", "grassy garden environment", "a stone path", "glowing orb", "wooden bridge"]) {
      expect(texts.some((t) => t.includes(phrase))).toBe(true);
    }
  });

  it("a GENUINE tester describing THREE states' visuals now clears ≥3 (was unmatchable as blobs)", () => {
    const genuine =
      "I tapped to step inside. First a sunset landscape with floating lanterns, then it dropped me into a grassy garden with a stone path, and later a glowing orb over a river by a wooden bridge.";
    expect(verifyAgainstKey(genuine, key).distinctSources).toBeGreaterThanOrEqual(3);
  });

  it("a CATEGORY guesser (generic vibes, no firsthand specifics) still stays below the bar", () => {
    const guess = "It's a calming, peaceful nature game with relaxing music and soft art where you wander around and meet gentle characters.";
    expect(verifyAgainstKey(guess, key).distinctSources).toBeLessThan(3);
  });

  it("a PARROT of the public card still scores ZERO (phrases from vision are not on the card)", () => {
    const parrot = "I experienced the world by reaching the opening screen of the product.";
    expect(verifyAgainstKey(parrot, key).distinctSources).toBe(0);
  });
});

describe("validateContradictions — hallucination-inert veto (verbatim pair or it never blocks)", () => {
  const key = distillPrivateKey(
    { ran: true, startUrl: "https://y/", mode: "interactive", pages: [], classification: "x", limitation: null, durationMs: 1,
      states: [{ trigger: "t", screenshot: "/0", visibleTextExcerpt: "a koi pond ripples in moonlight", notableElements: [], pixelDeltaPct: 100, url: "https://y/" }],
      visionObservations: [] } as never,
    ["public card text"],
  );
  const account = "i saw a koi pond ripples in moonlight and it was calm";
  it("BLOCKS only when BOTH quotes are literal substrings (account + a pinned observation)", () => {
    const v = validateContradictions([{ accountQuote: "koi pond ripples in moonlight", corpusQuote: "koi pond ripples in moonlight" }], account, key);
    expect(v.validated.length).toBe(1);
    expect(v.unverified.length).toBe(0);
  });
  it("a fabricated pair (quotes absent from the text) is UNVERIFIED and never blocks", () => {
    const v = validateContradictions([{ accountQuote: "a checkout button", corpusQuote: "a shopping cart" }], account, key);
    expect(v.validated.length).toBe(0);
    expect(v.unverified.length).toBe(1);
  });
  it("a half-real pair (account quote real, corpus quote fabricated) does NOT validate", () => {
    const v = validateContradictions([{ accountQuote: "koi pond ripples in moonlight", corpusQuote: "a pricing page with three tiers" }], account, key);
    expect(v.validated.length).toBe(0);
  });
  it("a one-filler-word 'quote' is too thin to be checkable → unverified", () => {
    const v = validateContradictions([{ accountQuote: "a", corpusQuote: "the" }], account, key);
    expect(v.validated.length).toBe(0);
  });
});

describe("legacyObservationBar — shadow-continuity only (confidence + raw contradictions gated)", () => {
  const base = { distinctSources: 3, keyDistinctSources: 6, rawContradictions: 0, obsConfidence: 0.95, nearDupClear: true, hasHighFraud: false };
  it("still gates on the OLD conditions so old-vs-new is comparable on real rows", () => {
    expect(legacyObservationBar(base).pass).toBe(true);
    expect(legacyObservationBar({ ...base, obsConfidence: 0.85 }).pass).toBe(false); // the wobble case
    expect(legacyObservationBar({ ...base, rawContradictions: 1 }).pass).toBe(false); // even a hallucinated one
  });
});
