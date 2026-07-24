import { describe, it, expect } from "vitest";
import { buildArchitectObservationView } from "./mission-grounding-shadow";
import type {
  ObservationSetV1,
  ActionTransitionV1,
  ObservedFactV1,
} from "./observed-facts";

/**
 * The architect may only be offered evidence the deterministic compiler can actually accept. A criterion
 * citing a transition whose safeClassification is not `safe` is rejected (`transition_not_safe`) — an
 * action Sage cannot autonomously replay may never back an action_outcome criterion. So an unsafe
 * transition is NOT presented as a citable id; it appears only as id-less `journey` context, and the
 * architect anchors that step on the FACTS it observed instead. (Purely client-side products emit no
 * requests at all, so `unverified` transitions are the common case — before this, they produced a
 * guaranteed-rejected plan.)
 */

const fact = (
  id: string,
  over: Partial<ObservedFactV1> = {},
): ObservedFactV1 => ({
  version: "obs-fact-v1",
  id,
  source: "dom",
  grounding: "seen",
  decisive: true,
  pageUrl: "https://p.test/",
  stateId: "st1",
  visibleTexts: ["Hello"],
  provenanceDigest: id,
  ...over,
});

const transition = (
  id: string,
  safe: ActionTransitionV1["safeClassification"],
): ActionTransitionV1 => ({
  version: "action-transition-v1",
  id,
  startUrl: "https://p.test/",
  beforeStateDigest: "st0",
  verb: "click",
  locator: { accessibleName: "primary control" },
  afterUrl: "https://p.test/",
  afterStateDigest: "st1",
  addedTexts: [`after-${id}`],
  removedTexts: [],
  observableChange: true,
  networkMethodSummary: safe === "safe" ? "get_observed" : "not_captured",
  safeClassification: safe,
  provenance: { fromStateIndex: 0, toStateIndex: 1 },
});

const set = (transitions: ActionTransitionV1[]): ObservationSetV1 => ({
  version: "obs-set-v1",
  facts: [fact("f1"), fact("f2")],
  transitions,
  captureVersion: 1,
  digest: "d1",
});

describe("buildArchitectObservationView — only compiler-acceptable transitions are citable", () => {
  it("presents SAFE transitions as citable ids", () => {
    const { view } = buildArchitectObservationView(
      set([transition("t1", "safe")]),
    );
    expect(view.transitions.map((t) => t.id)).toEqual(["t1"]);
    expect(view.journey).toHaveLength(0);
  });

  it("does NOT present unverified / state-changing transitions as citable ids", () => {
    const { view } = buildArchitectObservationView(
      set([
        transition("t1", "unverified"),
        transition("t2", "state_changing"),
        transition("t3", "unsafe"),
      ]),
    );
    expect(view.transitions).toHaveLength(0); // nothing citable → no guaranteed-rejected action criteria
    expect(view.journey).toHaveLength(3); // but the steps are still described…
    for (const j of view.journey)
      expect(Object.keys(j).sort()).toEqual(["did", "thenSaw"]); // …with NO id field to cite
  });

  it("keeps the observed outcome of a non-replayable step visible (so a state criterion can be designed)", () => {
    const { view } = buildArchitectObservationView(
      set([transition("t1", "unverified")]),
    );
    expect(JSON.stringify(view.journey)).toContain("after-t1");
    expect(JSON.stringify(view.journey)).toContain("primary control");
  });

  it("mixes correctly: safe ones citable, unsafe ones journey-only", () => {
    const { view, meta } = buildArchitectObservationView(
      set([transition("s1", "safe"), transition("u1", "unverified")]),
    );
    expect(view.transitions.map((t) => t.id)).toEqual(["s1"]);
    expect(view.journey).toHaveLength(1);
    expect(meta.totalTransitions).toBe(2); // telemetry still reports the true total
  });

  it("facts are always presented (the anchor for state criteria)", () => {
    const { view } = buildArchitectObservationView(
      set([transition("t1", "unverified")]),
    );
    expect(view.facts.map((f) => f.id).sort()).toEqual(["f1", "f2"]);
  });

  it("the note tells the architect never to cite journey steps", () => {
    const { view } = buildArchitectObservationView(set([]));
    expect(view.note).toMatch(/never cite/i);
  });
});
