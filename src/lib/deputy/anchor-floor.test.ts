import { describe, it, expect } from "vitest";
import { observationBar, OBS_BAR, type ObservationSignals } from "./observation-verify";

/**
 * THE ANCHOR FLOOR — the model may bridge, but it may not be the SOLE basis for moving money.
 *
 * `validateCorroborations` is real code: both quotes verbatim, a non-public token required on the
 * account side, one claim earning at most one source. It is a sound recall path and it stays. But the
 * MODEL picks the corpus quote — it can see the corpus — so what a corroboration actually binds is
 * only that the account holds some firsthand phrase the model was willing to link. Three of those and
 * nothing else, and an autonomous payout rests entirely on the model's semantic judgment, which is the
 * one thing this module says it never does.
 *
 * REPLAYED FROM PROD. Every shadow row Sage has ever written is below, with its real numbers. The two
 * well-anchored payouts must stay paid, the two holds must stay held, and exactly one row may change:
 * the payout that cleared on 0 deterministic + 3 model-bridged sources.
 */

const base: ObservationSignals = {
  distinctSources: 3,
  deterministicSources: 3,
  keyDistinctSources: 6,
  vetoFired: false,
  nearDupClear: true,
  hasHighFraud: false,
};

const sig = (over: Partial<ObservationSignals>): ObservationSignals => ({ ...base, ...over });

describe("the real shadow rows, replayed", () => {
  it.each([
    // submission,      det, corr-total, key, was, must-still-be
    ["eutUI9Qra985", 3, 4, 6, true, true],
    ["VrgkqtXEtZoE", 4, 5, 9, true, true],
    ["v5ooFtcT_o6W", 1, 1, 8, false, false],
    ["KFOUon_ID25e", 0, 0, 6, false, false],
  ])("%s is unchanged", (_id, det, dist, key, _was, expected) => {
    const r = observationBar(
      sig({ deterministicSources: det as number, distinctSources: dist as number, keyDistinctSources: key as number }),
    );
    expect(r.pass).toBe(expected);
  });

  it("ZKFS8PgbizFh — the one row that changes — now HOLDS instead of auto-paying", () => {
    // 0 deterministic, 3 sources entirely from model-bridged corroboration.
    const r = observationBar(sig({ deterministicSources: 0, distinctSources: 3, keyDistinctSources: 6 }));
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/no_deterministic_anchor/);
  });

  it("holding is not rejecting — the founder can still pay it", () => {
    // The floor produces a reason, which is a hold for review. Nothing here rejects the tester.
    const r = observationBar(sig({ deterministicSources: 0, distinctSources: 3 }));
    expect(r.reasons).toHaveLength(1); // ONLY the anchor objection; the work is otherwise clean
  });
});

describe("one real anchor is enough — the recall path still pays", () => {
  it("a mostly-paraphrased account with a single token match still passes", () => {
    // The genuine case the corroboration path exists for: 1 deterministic + 2 bridged.
    const r = observationBar(sig({ deterministicSources: 1, distinctSources: 3 }));
    expect(r.pass).toBe(true);
  });

  it("the floor is exactly one, not a proportion of the total", () => {
    expect(OBS_BAR.minDeterministicSources).toBe(1);
    expect(observationBar(sig({ deterministicSources: 1, distinctSources: 9 })).pass).toBe(true);
  });
});

describe("the criteria-complete pass cannot override the floor", () => {
  it("proving every criterion through model bridges alone still holds", () => {
    // This is precisely the case the floor exists for, so the relaxation must not rescue it.
    const r = observationBar(
      sig({ deterministicSources: 0, distinctSources: 2, criteriaAllProven: true }),
    );
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/no_deterministic_anchor/);
  });

  it("but the pass still works when there IS an anchor", () => {
    // 2 sources (under the flat 3) + every criterion proven + a real anchor → still pays, as before.
    const r = observationBar(
      sig({ deterministicSources: 1, distinctSources: 2, criteriaAllProven: true }),
    );
    expect(r.pass).toBe(true);
  });
});

describe("a caller that does not supply the split keeps the old behaviour", () => {
  it("omitting deterministicSources never introduces a new hold", () => {
    const { deterministicSources: _omit, ...without } = sig({ distinctSources: 3 });
    expect(observationBar(without as ObservationSignals).pass).toBe(true);
  });

  it("the floor is the ONLY thing the omission changes", () => {
    const withAnchor = observationBar(sig({ deterministicSources: 1, distinctSources: 3 }));
    const { deterministicSources: _o, ...without } = sig({ distinctSources: 3 });
    expect(observationBar(without as ObservationSignals)).toEqual(withAnchor);
  });
});

describe("the floor never rescues work that failed for another reason", () => {
  it.each([
    ["a validated contradiction", { vetoFired: true }],
    ["a near-duplicate", { nearDupClear: false }],
    ["high fraud", { hasHighFraud: true }],
    ["a thin corpus", { keyDistinctSources: 2 }],
  ])("%s still blocks even with a strong anchor", (_label, over) => {
    const r = observationBar(sig({ deterministicSources: 9, distinctSources: 9, ...over }));
    expect(r.pass).toBe(false);
  });
});
