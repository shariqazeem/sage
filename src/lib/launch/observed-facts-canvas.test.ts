import { describe, it, expect } from "vitest";
import { deriveObservations } from "./observed-facts";
import type { FieldTestState, FieldTestSummary } from "./schemas";

/**
 * A canvas / screenshot-only state is a REAL browser state — Sage reached it (a screenshot + the action
 * that produced it), even with no DOM text. It must still become a citable `seen` fact so a pure-canvas
 * product isn't discarded as "no observations". DOM-ful states stay byte-identical to before.
 */

const state = (over: Partial<FieldTestState>): FieldTestState => ({
  trigger: "initial load",
  screenshot: "/api/field-tests/x/0",
  visibleTextExcerpt: "",
  notableElements: [],
  pixelDeltaPct: 0,
  url: "https://game.example/",
  ...over,
});

const summary = (states: FieldTestState[]): FieldTestSummary => ({
  ran: true, startUrl: "https://game.example/", mode: "interactive", pages: [], states,
  classification: `${states.length} states`, limitation: null, durationMs: 1000,
});

describe("deriveObservations — canvas/screenshot states are citable", () => {
  it("a pure-canvas state (no DOM text) still yields ≥1 seen fact from the reached state", () => {
    const set = deriveObservations(
      summary([
        state({ trigger: "initial load", screenshot: "/api/field-tests/x/0" }),
        state({ trigger: "moved with ArrowRight", screenshot: "/api/field-tests/x/1", pixelDeltaPct: 40 }),
      ]),
    );
    // both canvas states are citable → the set is NOT empty, so the grounded architect isn't starved.
    expect(set.facts.length).toBeGreaterThanOrEqual(2);
    expect(set.facts.every((f) => f.grounding === "seen" && f.decisive)).toBe(true);
    // and the state change is a transition.
    expect(set.transitions.length).toBe(1);
    expect(set.transitions[0].observableChange).toBe(true);
  });

  it("a DOM-ful state is UNCHANGED — its facts come from elements + text, not the canvas fallback", () => {
    const domState = state({
      trigger: "clicked 'Come in'",
      visibleTextExcerpt: "Welcome to the grove",
      notableElements: [{ tag: "button", text: "Come in", role: "" }],
      screenshot: "/api/field-tests/x/2",
    });
    const withFallback = deriveObservations(summary([domState]));
    // the fallback only fires when a state produced nothing; a DOM-ful state produces element+text facts.
    const texts = withFallback.facts.flatMap((f) => f.visibleTexts);
    expect(texts).toContain("Come in");
    expect(texts).toContain("Welcome to the grove");
  });

  it("no screenshot + no DOM → no fabricated fact (honest)", () => {
    const set = deriveObservations(summary([state({ screenshot: null, visibleTextExcerpt: "", notableElements: [] })]));
    expect(set.facts.length).toBe(0);
  });

  it("full propagation: N states → facts + (N-1) transitions, deterministic digest", () => {
    const s = summary([
      state({ trigger: "initial load", visibleTextExcerpt: "Yara", notableElements: [{ tag: "button", text: "tap to step inside", role: "" }] }),
      state({ trigger: "clicked 'tap to step inside'", visibleTextExcerpt: "breathe", pixelDeltaPct: 30 }),
      state({ trigger: "clicked 'come in'", visibleTextExcerpt: "You are in the grove. Yara is here.", pixelDeltaPct: 50, notableElements: [{ tag: "button", text: "Yara", role: "" }] }),
    ]);
    const a = deriveObservations(s);
    const b = deriveObservations(s);
    expect(a.digest).toBe(b.digest); // pure + deterministic
    expect(a.transitions.length).toBe(2);
    // the goal-relevant journey is now citable text.
    const allText = a.facts.flatMap((f) => f.visibleTexts).join(" ");
    expect(allText).toContain("tap to step inside");
    expect(allText).toContain("Yara");
  });
});
