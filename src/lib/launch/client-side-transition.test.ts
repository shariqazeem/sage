import { describe, it, expect } from "vitest";
import { deriveObservations } from "./observed-facts";

/**
 * NO REQUEST IS NOT NO EVIDENCE — IT IS THE BEST EVIDENCE.
 *
 * An empty network-method list was read as "not_captured" → `unverified` → never citable, which
 * excluded every purely client-side interaction: opening a modal, a tab, an accordion, a feedback
 * panel. Measured on sagepays.xyz (2026-08-15): all 9 transitions of a run came back `unverified`,
 * the citable list was EMPTY, and every mission the architect designed was rejected for having no
 * groundable action — while the founder was asking, for the fourth time, for a mission about
 * clicking a Feedback button that makes no network call at all.
 */
const state = (i: number, trigger: string, methods: string[] | undefined, text: string) => ({
  url: "https://app.test/",
  trigger,
  visibleTextExcerpt: text,
  pixelDeltaPct: 10,
  notableElements: [{ role: "button", text: "Feedback" }],
  ...(methods === undefined ? {} : { networkMethods: methods }),
});

const setOf = (states: unknown[]) =>
  deriveObservations({ ran: true, mode: "interactive", startUrl: "https://app.test/", states, pages: [] } as never);

describe("safeClassification of a client-side action", () => {
  it("a click that issues NO request is safe and citable", () => {
    const set = setOf([
      state(0, "initial load", [], "Turn your product into a plan"),
      state(1, 'clicked "Feedback"', [], "Tell us anything · Send"),
    ]);
    const t = set.transitions[0];
    expect(t?.networkMethodSummary).toBe("none_observed");
    expect(t?.safeClassification).toBe("safe");
  });

  it("GET-only is still safe", () => {
    const set = setOf([
      state(0, "initial load", [], "Home"),
      state(1, 'clicked "Docs"', ["GET"], "Docs index"),
    ]);
    expect(set.transitions[0]?.safeClassification).toBe("safe");
  });

  it("a mutating method is still state_changing — this must never widen", () => {
    const set = setOf([
      state(0, "initial load", [], "Home"),
      state(1, 'clicked "Delete"', ["POST"], "Deleted"),
    ]);
    expect(set.transitions[0]?.networkMethodSummary).toBe("state_changing");
    expect(set.transitions[0]?.safeClassification).toBe("state_changing");
  });

  it("capture that never RAN is still unverified — the genuinely unknown case fails closed", () => {
    const set = setOf([
      state(0, "initial load", undefined, "Home"),
      state(1, 'clicked "Feedback"', undefined, "Tell us anything"),
    ]);
    expect(set.transitions[0]?.networkMethodSummary).toBe("not_captured");
    expect(set.transitions[0]?.safeClassification).toBe("unverified");
  });
});
