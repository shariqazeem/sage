import { describe, it, expect, afterEach } from "vitest";
import { buildProbe, buildProbes, inspectionReplayMode, allowedKey } from "./inspection-replay";
import { deriveObservations } from "./observed-facts";
import type { ActionTransitionV1, ObservationSetV1 } from "./observed-facts";
import type { FieldTestState, FieldTestSummary } from "./schemas";

const state = (over: Partial<FieldTestState>): FieldTestState => ({
  trigger: "initial load", screenshot: null, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 0, url: "https://p.test/", networkMethods: ["GET"], ...over,
});
/** a realistic set: load → click 'Start' → "Talk to Yara" appears. */
function yaraSet(): ObservationSetV1 {
  const ft: FieldTestSummary = {
    ran: true, startUrl: "https://p.test/", mode: "interactive", pages: [], classification: null, limitation: null, durationMs: 10,
    states: [
      state({ trigger: "initial load", visibleTextExcerpt: "Welcome. Press start.", notableElements: [{ tag: "button", text: "Start", role: "button" }] }),
      state({ trigger: "clicked 'Start'", url: "https://p.test/play", visibleTextExcerpt: "The world. Talk to Yara.", notableElements: [{ tag: "button", text: "Talk to Yara", role: "button" }], pixelDeltaPct: 40 }),
    ],
  };
  return deriveObservations(ft);
}
const transitionOf = (set: ObservationSetV1) => set.transitions[0];

afterEach(() => { delete process.env.INSPECTION_REPLAY_MODE; });

describe("inspection replay — deterministic safety gate", () => {
  it("mode defaults to off; only exact 'shadow' arms it", () => {
    delete process.env.INSPECTION_REPLAY_MODE; expect(inspectionReplayMode()).toBe("off");
    process.env.INSPECTION_REPLAY_MODE = "enforce"; expect(inspectionReplayMode()).toBe("off"); // unknown → off
    process.env.INSPECTION_REPLAY_MODE = "shadow"; expect(inspectionReplayMode()).toBe("shadow");
  });

  it("builds a probe from a real safe click transition, grounded in a seen after-state fact", () => {
    const set = yaraSet();
    const r = buildProbe(transitionOf(set), set);
    expect("probe" in r).toBe(true);
    if ("probe" in r) {
      expect(r.probe.verb).toBe("click");
      expect(r.probe.locator.accessibleName).toBe("Start");
      expect(r.probe.expectedAddedTexts.some((t) => /Talk to Yara|The world/.test(t))).toBe(true);
      expect(r.probe.sourceFactIds.length).toBeGreaterThan(0);
      expect(r.probe.sourceTransitionId).toBe(transitionOf(set).id);
    }
  });

  it("REJECTS an unsafe transition", () => {
    const set = yaraSet();
    const t: ActionTransitionV1 = { ...transitionOf(set), safeClassification: "unsafe" };
    expect(buildProbe(t, set)).toEqual({ rejected: "unsafe_transition" });
  });

  it("REJECTS a transition whose original request was state-changing", () => {
    const set = yaraSet();
    const t: ActionTransitionV1 = { ...transitionOf(set), networkMethodSummary: "state_changing" };
    expect(buildProbe(t, set)).toEqual({ rejected: "state_changing_request" });
  });

  it("REJECTS a non-replayable verb (only click/press/scroll)", () => {
    const set = yaraSet();
    for (const verb of ["load", "wait"] as const) {
      expect(buildProbe({ ...transitionOf(set), verb }, set)).toEqual({ rejected: `verb_not_replayable:${verb}` });
    }
  });

  it("REJECTS a click with no locator (never a model-authored / empty target)", () => {
    const set = yaraSet();
    const t: ActionTransitionV1 = { ...transitionOf(set), locator: {} };
    expect(buildProbe(t, set)).toEqual({ rejected: "no_locator" });
  });

  it("REJECTS when the observed change is NOT grounded in a seen after-state fact", () => {
    const set = yaraSet();
    // a transition claiming a change whose text is in NO seen fact of the after-state.
    const t: ActionTransitionV1 = { ...transitionOf(set), addedTexts: ["ghost text never captured"], afterStateDigest: "no-such-state", observableChange: true };
    expect(buildProbe(t, set)).toEqual({ rejected: "expectation_not_grounded" });
  });

  it("buildProbes yields only the safe, grounded probes from a set", () => {
    const set = yaraSet();
    const probes = buildProbes(set);
    expect(probes.length).toBe(1);
    expect(probes[0].verb).toBe("click");
  });

  it("REJECTS an UNVERIFIED transition (network not captured → not positively safe)", () => {
    const set = yaraSet();
    const t: ActionTransitionV1 = { ...transitionOf(set), safeClassification: "unverified", networkMethodSummary: "not_captured" };
    expect(buildProbe(t, set)).toEqual({ rejected: "unsafe_transition" });
  });

  it("REJECTS a press whose key is not on the allowlist (no synthesized Enter)", () => {
    const set = yaraSet();
    const t: ActionTransitionV1 = { ...transitionOf(set), verb: "press", locator: { accessibleName: "F13" } };
    expect(buildProbe(t, set)).toEqual({ rejected: "key_not_allowlisted:F13" });
  });

  it("allowedKey is a strict allowlist — unknown keys return null (never Enter)", () => {
    expect(allowedKey("Space")).toBe("Space");
    expect(allowedKey("ArrowLeft")).toBe("ArrowLeft");
    expect(allowedKey("a")).toBe("a");
    expect(allowedKey("F13")).toBeNull();
    expect(allowedKey("PageDown")).toBeNull();
    expect(allowedKey(undefined)).toBeNull();
  });
});
