import { describe, it, expect } from "vitest";

/**
 * THE EVICTION ORDER IS A POLICY, NOT A TIE-BREAK.
 *
 * Measured on sagepays.xyz (2026-08-15): the architect was handed 60 of 68 facts and **0 of 9
 * transitions**. Transitions are the ONLY citable actions, so not one `action_outcome` criterion
 * could be written, and all six missions it designed were thrown out by the canonical gate
 * (unsupported_evidence_type x4, worthless_presence_check x2). The founder's goal read as
 * "unobserved" and the whole run fell back to the legacy planner.
 *
 * This pins the ORDER as pure logic — journey, then facts down to a floor, then transitions — so a
 * future size tweak cannot quietly re-introduce "spend the whole budget on the abundant thing".
 */
const FACT_FLOOR = 24;

/** the shipped loop, as a pure reduction over counts. */
function evict(
  start: { journey: number; facts: number; transitions: number },
  fits: (v: { journey: number; facts: number; transitions: number }) => boolean,
) {
  let v = { ...start };
  while (!fits(v) && (v.journey > 0 || v.facts > 8 || v.transitions > 0)) {
    if (v.journey > 0) v = { ...v, journey: v.journey - 1 };
    else if (v.facts > FACT_FLOOR) v = { ...v, facts: v.facts - 1 };
    else if (v.transitions > 0) v = { ...v, transitions: v.transitions - 1 };
    else v = { ...v, facts: v.facts - 1 };
  }
  return v;
}

describe("observation-view eviction order", () => {
  it("the measured case: 68 facts / 9 transitions keeps EVERY transition", () => {
    // budget forces ~34 items out; under the old order all 9 transitions went first
    const out = evict({ journey: 3, facts: 68, transitions: 9 }, (v) => v.journey + v.facts + v.transitions <= 40);
    expect(out.transitions).toBe(9);
    expect(out.facts).toBe(31);
    expect(out.journey).toBe(0); // id-less context is never citable — it goes first
  });

  it("facts stop at the floor before a single transition is touched", () => {
    const out = evict({ journey: 0, facts: 60, transitions: 5 }, (v) => v.facts + v.transitions <= 29);
    expect(out.facts).toBe(FACT_FLOOR);
    expect(out.transitions).toBe(5);
  });

  it("a brutal budget does eventually drop transitions — the cap is still a cap", () => {
    const out = evict({ journey: 0, facts: 60, transitions: 5 }, (v) => v.facts + v.transitions <= 20);
    expect(out.transitions).toBe(0);
    expect(out.facts).toBeLessThanOrEqual(20);
  });

  it("never evicts below 8 facts while anything else remains", () => {
    const out = evict({ journey: 0, facts: 30, transitions: 4 }, () => false);
    expect(out.facts).toBe(8);
    expect(out.transitions).toBe(0);
  });

  it("a view that already fits is untouched", () => {
    const start = { journey: 2, facts: 12, transitions: 3 };
    expect(evict(start, () => true)).toEqual(start);
  });
});
