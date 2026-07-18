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

  it("a genuine account that CONTRADICTS the corpus is killed even with a clean-looking match count", () => {
    const genuine = observationCases.find((c) => c.label === "genuine-yara")!;
    const d = assembleObservationDecision({
      account: genuine.account,
      key: keys.yara,
      priors: [],
      judge: { obsConfidence: 0.95, contradictions: ["claimed a checkout page yara has none of"] },
      hasHighFraud: false,
    });
    expect(d.bar.pass).toBe(false);
    expect(d.bar.reasons.some((r) => r.startsWith("contradiction"))).toBe(true);
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
      judge: { obsConfidence: 0.95, contradictions: ["a private contradiction detail"] },
      hasHighFraud: false,
    });
    // sanity: server-side DID match real private strings
    expect(d.corpusMatch.matchedCount).toBeGreaterThan(0);

    const publicSerialized = JSON.stringify(d.publicView).toLowerCase();
    // NONE of the matched private observation strings may appear on the public surface.
    for (const obs of d.corpusMatch.matched) {
      expect(publicSerialized).not.toContain(obs.text);
    }
    // nor any contradiction text
    for (const contradiction of d.contradictions) {
      expect(publicSerialized).not.toContain(contradiction.toLowerCase());
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
