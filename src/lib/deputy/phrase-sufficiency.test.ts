import { describe, expect, it } from "vitest";

import {
  observationBar,
  OBS_BAR,
  PHRASE_SUFFICIENT_ANCHORS,
  type ObservationSignals,
} from "./observation-verify";

/**
 * A RIGHT ANSWER MUST NOT BE PAID ON A COIN FLIP.
 *
 * The flat bar counts distinct SOURCES, and a source is roughly a screen, so a tester who explores
 * one screen thoroughly can write an unmistakably genuine account and still count as one. Their
 * payout then rested entirely on the LLM corroboration bridge — the one non-deterministic part of
 * the judgment.
 *
 * Measured against the live judge: one genuine account naming seven real product phrases, run eight
 * times. Deterministic signal identical every run (1 source, 7 anchors). The model returned 8
 * corroborations twice and zero the other six times. The account passed 2 of 8.
 *
 * Phrases from inside a product cannot be written by someone who never opened it, and unlike a
 * corroboration they involve no model judgment. Above the threshold they now carry the evidence
 * question themselves. These tests hold the line on what that must NOT do.
 */

const base = (over: Partial<ObservationSignals> = {}): ObservationSignals => ({
  distinctSources: 1,
  deterministicSources: 1,
  phraseAnchors: PHRASE_SUFFICIENT_ANCHORS,
  keyDistinctSources: OBS_BAR.minKeySources + 2,
  vetoFired: false,
  nearDupClear: true,
  hasHighFraud: false,
  ...over,
});

describe("strong deterministic evidence stands on its own", () => {
  it("clears when only the flat count objects", () => {
    const r = observationBar(base());
    expect(r.pass).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("is not flaky — the same signals always give the same verdict", () => {
    // The whole point. No model is consulted on this path.
    const verdicts = Array.from({ length: 8 }, () => observationBar(base()).pass);
    expect(new Set(verdicts).size).toBe(1);
    expect(verdicts[0]).toBe(true);
  });

  it("still clears the ordinary way when there are enough distinct sources", () => {
    const r = observationBar(base({ phraseAnchors: 0, distinctSources: OBS_BAR.minDistinctMatches, deterministicSources: 2 }));
    expect(r.pass).toBe(true);
  });
});

describe("what the pass must never override", () => {
  it("a validated contradiction still holds", () => {
    const r = observationBar(base({ vetoFired: true }));
    expect(r.pass).toBe(false);
    expect(r.reasons).toContain("contradiction");
  });

  it("a near-duplicate still holds", () => {
    const r = observationBar(base({ nearDupClear: false }));
    expect(r.pass).toBe(false);
    expect(r.reasons).toContain("near_dup");
  });

  it("a high-severity fraud signal still holds", () => {
    const r = observationBar(base({ hasHighFraud: true }));
    expect(r.pass).toBe(false);
    expect(r.reasons).toContain("high_fraud");
  });

  it("a corpus too thin to verify against still holds", () => {
    const r = observationBar(base({ keyDistinctSources: OBS_BAR.minKeySources - 1 }));
    expect(r.pass).toBe(false);
    expect(r.reasons.join(",")).toMatch(/thin_corpus/);
  });

  it("an unproven criterion from a COMPILER-authored contract still holds", () => {
    const r = observationBar(base({ unprovenCriteria: [1], criteriaAdvisory: false }));
    expect(r.pass).toBe(false);
    expect(r.reasons.join(",")).toMatch(/criteria_unproven/);
  });
});

describe("what the pass must never let through", () => {
  it("phrases without any deterministic anchor do NOT clear", () => {
    // The pass deliberately requires a deterministic match as well, so paraphrase alone can never
    // carry a payout. Note the hold reason is the flat count, not the floor: the floor accepts
    // EITHER signal, so 20 phrases satisfies it — this pass is the stricter of the two, on purpose.
    const r = observationBar(base({ deterministicSources: 0, phraseAnchors: 20 }));
    expect(r.pass).toBe(false);
    expect(r.reasons.join(",")).toMatch(/few_matches/);
  });

  it("too few phrases do NOT clear on their own", () => {
    const r = observationBar(base({ phraseAnchors: PHRASE_SUFFICIENT_ANCHORS - 1 }));
    expect(r.pass).toBe(false);
    expect(r.reasons.join(",")).toMatch(/few_matches/);
  });

  it("a fabrication — zero of everything — is refused", () => {
    const r = observationBar(base({ distinctSources: 0, deterministicSources: 0, phraseAnchors: 0 }));
    expect(r.pass).toBe(false);
    expect(r.reasons.join(",")).toMatch(/no_product_anchor/);
  });

  it("an older caller that supplies no split is unaffected", () => {
    // deterministicSources undefined ⇒ the floor is not applied, and neither is this pass.
    const r = observationBar({
      distinctSources: 1,
      keyDistinctSources: OBS_BAR.minKeySources + 2,
      vetoFired: false,
      nearDupClear: true,
      hasHighFraud: false,
    });
    expect(r.pass).toBe(false);
    expect(r.reasons.join(",")).toMatch(/few_matches/);
    expect(r.reasons.join(",")).not.toMatch(/no_product_anchor/);
  });
});
