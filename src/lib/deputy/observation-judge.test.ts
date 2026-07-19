import { describe, expect, it } from "vitest";
import { distillPrivateKey } from "./observation-verify";
import { assembleObservationDecision, type ObservationJudgeResult } from "./observation-judge";
import {
  observationCases,
  yaraFieldTest,
  yaraPublicStrings,
  excalidrawFieldTest,
  excalidrawPublicStrings,
} from "./observation-fixtures";

const keys = {
  yara: distillPrivateKey(yaraFieldTest, yaraPublicStrings),
  excalidraw: distillPrivateKey(excalidrawFieldTest, excalidrawPublicStrings),
};

// A CLEAN LLM judge result (high confidence, no contradictions), so the DETERMINISTIC conditions are
// what decide each fixture — the judge is proven separately in the live eval.
const cleanJudge: ObservationJudgeResult = { obsConfidence: 0.95, contradictions: [] };

const priorsFor = (label: string | undefined) =>
  label
    ? [{ note: observationCases.find((x) => x.label === label)!.account, contentSha256: null }]
    : [];

describe("observation fixtures ARE the spec (deterministic contract, no LLM)", () => {
  it("both pinned keys are campaign-eligible (≥5 distinct sources)", () => {
    expect(keys.yara.distinctSources).toBeGreaterThanOrEqual(5);
    expect(keys.excalidraw.distinctSources).toBeGreaterThanOrEqual(5);
  });

  for (const c of observationCases) {
    it(`${c.label}: matches its asserted deterministic outcome`, () => {
      const d = assembleObservationDecision({
        account: c.account,
        key: keys[c.product],
        priors: priorsFor(c.expect.nearDupOf),
        judge: cleanJudge,
        hasHighFraud: false,
      });
      if (c.expect.minDistinct != null) expect(d.corpusMatch.distinctSources).toBeGreaterThanOrEqual(c.expect.minDistinct);
      if (c.expect.maxDistinct != null) expect(d.corpusMatch.distinctSources).toBeLessThanOrEqual(c.expect.maxDistinct);
      if (c.expect.injection != null) expect(d.injectionDetected).toBe(c.expect.injection);
      if (c.expect.nearDupOf) expect(d.nearDupSimilarity).toBeGreaterThan(0);
      // deterministicClears = with a CLEAN judge, does the bar pass? (genuine yes; adversarial no)
      expect(d.bar.pass).toBe(c.expect.deterministicClears);
    });
  }

  it("a VALIDATED contradiction (verbatim account↔corpus pair) kills a clean-looking match count", () => {
    const genuine = observationCases.find((c) => c.label === "genuine-yara")!;
    const d = assembleObservationDecision({
      account: genuine.account,
      key: keys.yara,
      priors: [],
      // both quotes are literal substrings (of the account, and of a pinned observation) → veto fires.
      judge: { obsConfidence: 0.95, contradictions: [{ accountQuote: "the cherry blossoms fall", corpusQuote: "cherry blossoms fall" }] },
      hasHighFraud: false,
    });
    expect(d.bar.pass).toBe(false);
    expect(d.bar.reasons).toContain("contradiction");
    expect(d.validatedContradictions.length).toBe(1);
  });

  it("a HALLUCINATED contradiction (quotes absent from the text) is logged unverified and NEVER blocks", () => {
    const genuine = observationCases.find((c) => c.label === "genuine-yara")!;
    const d = assembleObservationDecision({
      account: genuine.account,
      key: keys.yara,
      priors: [],
      // low confidence AND a fabricated contradiction — under 2b neither can move the outcome.
      judge: { obsConfidence: 0.4, contradictions: [{ accountQuote: "there was a checkout button", corpusQuote: "a shopping cart icon" }] },
      hasHighFraud: false,
    });
    expect(d.bar.pass).toBe(true);
    expect(d.validatedContradictions.length).toBe(0);
    expect(d.unverifiedContradictions.length).toBe(1);
  });

  it("CONFIDENCE no longer gates — the same genuine account clears at 0.40, 0.85, and 0.95 alike (2b)", () => {
    const genuine = observationCases.find((c) => c.label === "genuine-yara")!;
    const clears = (obsConfidence: number) =>
      assembleObservationDecision({ account: genuine.account, key: keys.yara, priors: [], judge: { obsConfidence, contradictions: [] }, hasHighFraud: false }).bar.pass;
    expect(clears(0.4)).toBe(true);
    expect(clears(0.85)).toBe(true);
    expect(clears(0.95)).toBe(true);
  });

  it("the legacy bar is logged alongside for continuity — it WOULD have flipped 0.95→0.85 on the wobble", () => {
    const genuine = observationCases.find((c) => c.label === "genuine-yara")!;
    const at95 = assembleObservationDecision({ account: genuine.account, key: keys.yara, priors: [], judge: { obsConfidence: 0.95, contradictions: [] }, hasHighFraud: false });
    const at85 = assembleObservationDecision({ account: genuine.account, key: keys.yara, priors: [], judge: { obsConfidence: 0.85, contradictions: [] }, hasHighFraud: false });
    // new bar: stable across the wobble. legacy bar: would have flipped — exactly the risk 2b removes.
    expect(at95.bar.pass).toBe(at85.bar.pass);
    expect(at95.legacyBar.pass).toBe(true);
    expect(at85.legacyBar.pass).toBe(false);
  });
});

/* ─────────────────── THE LEAK RULE — a zero-leakage test (activity-feed style) ─────────────────── */

describe("observation publicView NEVER leaks the answer key", () => {
  it("carries counts + distinct-source count + digest only — no matched string, no account quote", () => {
    const genuine = observationCases.find((c) => c.label === "genuine-yara")!;
    const d = assembleObservationDecision({
      account: genuine.account,
      key: keys.yara,
      priors: [],
      judge: { obsConfidence: 0.95, contradictions: [{ accountQuote: "the cherry blossoms fall", corpusQuote: "cherry blossoms fall" }] },
      hasHighFraud: false,
    });
    // sanity: server-side DID match real private strings
    expect(d.corpusMatch.matchedCount).toBeGreaterThan(0);

    const publicSerialized = JSON.stringify(d.publicView).toLowerCase();
    // NONE of the matched private observation strings may appear on the public surface.
    for (const obs of d.corpusMatch.matched) {
      expect(publicSerialized).not.toContain(obs.text);
    }
    // nor any contradiction quote (validated OR unverified — both are server-side only)
    for (const c of [...d.validatedContradictions, ...d.unverifiedContradictions]) {
      expect(publicSerialized).not.toContain(c.accountQuote.toLowerCase());
      expect(publicSerialized).not.toContain(c.corpusQuote.toLowerCase());
    }
    // and the public claim IS auditable: a count + the corpus digest.
    expect(d.publicView.distinctSources).toBeGreaterThanOrEqual(3);
    expect(d.publicView.corpusDigest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("the public bar reasons are count-only enumerated tokens, never free text", () => {
    const parrot = observationCases.find((c) => c.label === "parrot-yara")!;
    const d = assembleObservationDecision({ account: parrot.account, key: keys.yara, priors: [], judge: cleanJudge, hasHighFraud: false });
    // every reason matches a strict token shape: name + optional (numbers/comparators) — no prose.
    for (const r of d.publicView.barReasons) {
      expect(r).toMatch(/^[a-z_]+(\([0-9.<>= ]+\))?$/);
    }
  });
});

/* ─────────── STABILITY — judge noise must not move the money decision (2b, red-team-tier) ─────────── */

describe("STABILITY — a genuine account's pay/hold is invariant to judge noise (blocks deploy)", () => {
  it("the SAME genuine fixture judged 5× with swinging confidence + hallucinated contradictions → identical outcome 5/5", () => {
    const genuine = observationCases.find((c) => c.label === "genuine-yara")!;
    // Simulate the observed provider wobble: confidence all over the place, and two runs where the model
    // hallucinated a contradiction whose quotes are NOT in the text (so they can't validate).
    const noisyRuns: ObservationJudgeResult[] = [
      { obsConfidence: 0.95, contradictions: [] },
      { obsConfidence: 0.85, contradictions: [] },
      { obsConfidence: 0.4, contradictions: [{ accountQuote: "a checkout page", corpusQuote: "a pricing table" }] },
      { obsConfidence: 0.99, contradictions: [] },
      { obsConfidence: 0.72, contradictions: [{ accountQuote: "absent from the account", corpusQuote: "absent from the corpus" }] },
    ];
    const outcomes = noisyRuns.map(
      (judge) => assembleObservationDecision({ account: genuine.account, key: keys.yara, priors: [], judge, hasHighFraud: false }).bar.pass,
    );
    expect(new Set(outcomes).size).toBe(1); // one outcome, 5/5 — the wobble cannot move money
    expect(outcomes.every((o) => o === true)).toBe(true); // and it's a PASS (genuine clears the arithmetic)
  });

  it("a parrot stays a HOLD under the same noise — the gate never flips it either", () => {
    const parrot = observationCases.find((c) => c.label === "parrot-yara")!;
    const outcomes = [0.99, 0.2, 0.8].map(
      (obsConfidence) => assembleObservationDecision({ account: parrot.account, key: keys.yara, priors: [], judge: { obsConfidence, contradictions: [] }, hasHighFraud: false }).bar.pass,
    );
    expect(outcomes.every((o) => o === false)).toBe(true);
  });
});
