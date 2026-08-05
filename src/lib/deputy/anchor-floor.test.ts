import { describe, it, expect } from "vitest";
import {
  observationBar,
  phraseAnchors,
  OBS_BAR,
  type ObservationSignals,
  type PrivateKey,
} from "./observation-verify";

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

  it("ZKFS8PgbizFh — 0 deterministic AND no product phrase — still HOLDS", () => {
    // 3 sources entirely from model-bridged corroboration, and nothing the tester could only have
    // read inside the product. The model alone still cannot move money.
    const r = observationBar(
      sig({ deterministicSources: 0, phraseAnchors: 0, distinctSources: 3, keyDistinctSources: 6 }),
    );
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/no_product_anchor/);
  });

  it("holding is not rejecting — the founder can still pay it", () => {
    // The floor produces a reason, which is a hold for review. Nothing here rejects the tester.
    const r = observationBar(sig({ deterministicSources: 0, phraseAnchors: 0, distinctSources: 3 }));
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
      sig({ deterministicSources: 0, phraseAnchors: 0, distinctSources: 2, criteriaAllProven: true }),
    );
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/no_product_anchor/);
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

/* ── the phrase anchor: a genuine tester in their OWN WORDS, or another language, must still pay ── */

/**
 * MEASURED against the live yara.garden corpus, not invented. These are the real strings: the corpus
 * lines are Sage's own recorded observations, and the "genuine" account is the one that was actually
 * paid $1 USDC on GOAT mainnet.
 */
const yaraKey: PrivateKey = {
  observations: [
    { source: "state:0", text: "oh hello i felt you arrive im yara i tend this place" },
    { source: "state:1", text: "i made it for people carrying something heavy" },
    { source: "state:2", text: "so they would have somewhere gentle to set it down" },
    { source: "state:3", text: "a loading screen with a prompt to tap to step inside" },
    { source: "state:4", text: "choose your companion a chick or a fox" },
    { source: "state:5", text: "before we walk together what has been weighing on you" },
  ],
  distinctSources: 6,
  digest: "0xtest",
};
// what a guesser can read WITHOUT visiting: the mission card.
const publicCard = [
  "Find and Interact with Yara",
  "Enter the virtual garden, locate the Yara character and have a conversation",
  "https://yara.garden/",
];

const anchors = (account: string) => phraseAnchors(account, yaraKey, publicCard).length;

describe("phrase anchors separate a real visit from a good story", () => {
  it("a genuine account in the tester's own words is anchored", () => {
    expect(
      anchors(
        "opened it, saw a loading screen, tapped to step inside. yara said she made this place for people carrying something heavy.",
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it("THE POINT: a genuine account in ANOTHER LANGUAGE is still anchored", () => {
    // Written in Urdu, keeping the product's own English strings as any real tester would.
    expect(
      anchors(
        "میں نے کھولا، loading screen نظر آئی، پھر tap to step inside کا prompt۔ Yara نے کہا یہ اُن کے لیے جو something heavy carrying کر رہے ہیں۔ میں نے chick چُنا۔",
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it("a fluent fabrication from someone who never visited is NOT anchored", () => {
    expect(
      anchors(
        "I visited the site and was greeted by a beautiful calming interface. The virtual garden loaded smoothly and I navigated the space easily. I located the Yara character and started a conversation. She responded thoughtfully and the dialogue felt natural and warm. The experience was polished with no errors.",
      ),
    ).toBe(0);
  });

  it("parroting the public mission card is NOT anchored", () => {
    expect(anchors(publicCard.join(" "))).toBe(0);
  });

  it("public phrases are subtracted, so the card can never anchor itself", () => {
    const keyWithPublic: PrivateKey = {
      observations: [{ source: "state:0", text: "enter the virtual garden locate the yara character" }],
      distinctSources: 1,
      digest: "0x",
    };
    expect(phraseAnchors("enter the virtual garden locate the yara character", keyWithPublic, publicCard))
      .toEqual([]);
  });

  it("an empty or absent account anchors nothing", () => {
    for (const a of ["", "   ", null, undefined]) {
      expect(phraseAnchors(a, yaraKey, publicCard)).toEqual([]);
    }
  });
});

describe("the widened floor pays the paraphraser without paying the fabricator", () => {
  it("zero token matches but a real product phrase → PASSES", () => {
    const r = observationBar(sig({ deterministicSources: 0, phraseAnchors: 2, distinctSources: 3 }));
    expect(r.pass).toBe(true);
  });

  it("zero token matches and zero phrases → HOLDS", () => {
    const r = observationBar(sig({ deterministicSources: 0, phraseAnchors: 0, distinctSources: 3 }));
    expect(r.pass).toBe(false);
  });

  it("one phrase is enough — the measured margin is genuine>=2 vs fake 0", () => {
    expect(OBS_BAR.minPhraseAnchors).toBe(1);
    expect(observationBar(sig({ deterministicSources: 0, phraseAnchors: 1, distinctSources: 3 })).pass).toBe(true);
  });
});
