import { describe, it, expect } from "vitest";
import {
  deriveCriterionEvidence,
  observationBar,
  type PrivateKey,
} from "./observation-verify";

/**
 * UNIVERSAL CRITERION CONTRACTS — and the guard that keeps them from doing harm.
 *
 * Only compiler-authored missions persisted a criterion→key-source contract; everything else fell to
 * the flat ≥3 bar. Deriving one lets every observation mission be judged per-criterion. But the
 * derivation is LEXICAL — it maps a criterion to the key sources whose observations share its
 * distinctive tokens — and that is a guess, not a fact.
 *
 * Measured on the LIVE yara mission before this guard existed: `state:28`/`state:29` hold Yara's
 * actual dialogue ("what brings you here", "there's no wrong answer", "i'll listen i'll remember") —
 * the most authentic evidence in the entire corpus — and they back NEITHER criterion, because that
 * dialogue shares no tokens with "the user experiences the outcome of interacting with yara". A
 * tester quoting exactly that was held on `criteria_unproven` FOR GIVING THE BEST POSSIBLE EVIDENCE.
 * Bridging that vocabulary gap is what the LLM corroboration path is for; a token match cannot.
 *
 * So: a DERIVED contract may help (arm the criteria-complete pass, drive coaching) and must never
 * block. A COMPILER-authored contract is authoritative and blocks exactly as before.
 */

const key: PrivateKey = {
  observations: [
    { source: "state:0", text: "welcome to the dashboard" },
    { source: "state:1", text: "export your report as pdf" },
    { source: "state:2", text: "what brings you here today" },
    { source: "state:2", text: "there is no wrong answer" },
  ],
  distinctSources: 3,
  digest: "0xkey",
};

describe("a criterion maps to the screens that share its distinctive words", () => {
  it("maps by content token, not by position", () => {
    const [c] = deriveCriterionEvidence(key, ["The user reaches the dashboard"]);
    expect(c!.keySources).toEqual(["state:0"]);
  });

  it("matches at a WORD START, so 'board' never backs 'keyboard'", () => {
    const [c] = deriveCriterionEvidence(
      { ...key, observations: [{ source: "state:9", text: "press any keyboard key" }] },
      ["The user reaches the board"],
    );
    expect(c!.keySources).toEqual([]);
  });

  it("ignores generic UI filler, which would otherwise map everything to everything", () => {
    const [c] = deriveCriterionEvidence(key, ["The user should click the button on the page"]);
    expect(c!.keySources).toEqual([]);
  });

  it("keeps short ENTITY names, which carry real signal at 4 characters", () => {
    const [c] = deriveCriterionEvidence(
      { ...key, observations: [{ source: "state:7", text: "yara tends this place" }] },
      ["The user interacts with Yara"],
    );
    expect(c!.keySources).toEqual(["state:7"]);
  });

  it("is deterministic, so a reused verdict stays sound", () => {
    const a = deriveCriterionEvidence(key, ["reach the dashboard", "export the report"]);
    const b = deriveCriterionEvidence(key, ["reach the dashboard", "export the report"]);
    expect(a).toEqual(b);
  });

  it("reports an unmappable criterion as an EMPTY slice — a design gap, never a tester failure", () => {
    const [c] = deriveCriterionEvidence(key, ["The experience feels delightful"]);
    expect(c!.keySources).toEqual([]);
  });
});

const signals = (over: Record<string, unknown> = {}) => ({
  distinctSources: 3,
  keyDistinctSources: 9,
  vetoFired: false,
  nearDupClear: true,
  hasHighFraud: false,
  matchedCount: 3,
  obsConfidence: 0.9,
  rawContradictions: 0,
  ...over,
});

describe("a DERIVED contract helps but never blocks", () => {
  it("does not hold an account that met the flat bar", () => {
    const r = observationBar(
      signals({ unprovenCriteria: [0, 1], criteriaAdvisory: true }) as never,
    );
    expect(r.pass).toBe(true);
    expect(r.reasons.join()).not.toMatch(/criteria_unproven/);
  });

  it("reproduces the live yara case: the best evidence in the corpus is not punished", () => {
    // 3 distinct matches, but they landed on screens the lexical derivation mapped to nothing.
    const r = observationBar(
      signals({ distinctSources: 3, unprovenCriteria: [0, 1], criteriaAdvisory: true }) as never,
    );
    expect(r.pass).toBe(true);
  });

  it("still arms the criteria-complete pass when it DOES prove", () => {
    const r = observationBar(
      signals({ distinctSources: 2, criteriaAllProven: true, criteriaAdvisory: true }) as never,
    );
    expect(r.pass).toBe(true); // 2 < 3 flat, rescued by every criterion proven
  });

  it("never overrides a real objection", () => {
    for (const bad of [{ vetoFired: true }, { nearDupClear: false }, { hasHighFraud: true }]) {
      const r = observationBar(
        signals({ ...bad, unprovenCriteria: [0], criteriaAdvisory: true }) as never,
      );
      expect(r.pass).toBe(false);
    }
  });
});

describe("a COMPILER-authored contract is authoritative and still blocks", () => {
  it("holds on an unproven criterion", () => {
    const r = observationBar(signals({ unprovenCriteria: [1] }) as never);
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/criteria_unproven\(1\)/);
  });

  it("blocks even when the flat count is satisfied", () => {
    const r = observationBar(
      signals({ distinctSources: 9, unprovenCriteria: [0] }) as never,
    );
    expect(r.pass).toBe(false);
  });

  it("advisory=false is the same as omitting it", () => {
    const a = observationBar(signals({ unprovenCriteria: [0] }) as never);
    const b = observationBar(
      signals({ unprovenCriteria: [0], criteriaAdvisory: false }) as never,
    );
    expect(a).toEqual(b);
  });
});
