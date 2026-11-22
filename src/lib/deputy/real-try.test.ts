import { describe, expect, it } from "vitest";
import type { BriefFraudSignal } from "./brain-core";
import { assembleObservationDecision } from "./observation-judge";
import { OBS_BAR, distillPrivateKey, publicTokenSet, type PrivateKey } from "./observation-verify";
import {
  CARD_PARROT_SIGNAL,
  NO_TRY_DETAIL_SIGNAL,
  NO_TRY_SIGNAL,
  RELEASE_LINE,
  THIN_PASS_SIGNAL,
  TRY_ONLY_MIN_SOURCES,
  TRY_PROVEN_SOURCES,
  contractFor,
  deterministicBarPass,
  escalateNoTry,
  judgeRealTry,
  missionTryReadiness,
  realTryShadow,
  realTrySignals,
  tryEvidence,
  type MissionCard,
} from "./real-try";
import { realTryMissions } from "./real-try-fixtures";

const key = (obs: [string, string][]): PrivateKey => ({
  observations: obs.map(([source, text]) => ({ source, text })),
  distinctSources: new Set(obs.map(([s]) => s)).size,
  digest: "0xkey",
});

const BOARD = key([
  ["state:0", "plan anything on one board"],
  ["state:1", "pick a starting layout kanban timeline"],
  ["state:2", "three empty columns doing done"],
  ["state:3", "card saved drag cards between columns"],
  ["state:4", "copy share link"],
  ["state:5", "template gallery sprint planning"],
]);
const card = (criteria: string[], extra: string[] = []): MissionCard => ({ publicStrings: [...extra, ...criteria], criteria });
const PLAIN = card(["The answer says where the tester stopped."], ["Try Driftboard"]);

const medium = (signal: string): BriefFraudSignal => ({ signal, severity: "med", reason: "x" });

describe("mission readiness: can the judge tell a parrot of the card from a try?", () => {
  it("a card that says nothing of what Sage saw leaves the mission autonomous", () => {
    const r = missionTryReadiness(BOARD, PLAIN);
    expect(r).toMatchObject({ cardSources: 0, cardClears: false, tryOnlySources: 5, autonomous: true });
  });

  it("a card whose criteria quote the product's screens clears the bar by itself: not autonomous", () => {
    const quoting = card([
      "The tester picks a starting layout kanban timeline.",
      "The tester sees three empty columns doing done.",
      "The tester sees card saved drag cards between columns.",
    ]);
    const r = missionTryReadiness(BOARD, quoting);
    expect(r.cardSources).toBe(3);
    expect(r.cardClears).toBe(true);
    expect(r.autonomous).toBe(false);
  });

  it("too little behind the first screen: not autonomous, whatever the card says", () => {
    const shallow = key([
      ["page:0", "plan anything on one board"],
      ["state:0", "boards for teams who hate meetings"],
      ["state:1", "pick a starting layout kanban timeline"],
      ["state:2", "three empty columns doing done"],
      // the header again on later screens: readable from the first screen, so not "only a try"
      ["state:3", "plan anything on one board"],
      ["state:4", "boards for teams who hate meetings"],
    ]);
    const r = missionTryReadiness(shallow, PLAIN);
    expect(r.cardClears).toBe(false);
    expect(r.tryOnlySources).toBe(2);
    expect(r.tryOnlySources).toBeLessThan(TRY_ONLY_MIN_SOURCES);
    expect(r.autonomous).toBe(false);
  });

  it("the thresholds are the bar's own numbers, not a second set", () => {
    expect(TRY_ONLY_MIN_SOURCES).toBe(OBS_BAR.minDistinctMatches);
  });

  it("'the card clears the bar' means the REAL bar: the same verdict the judge's own assembly gives, on every fixture voice", () => {
    for (const m of realTryMissions) {
      const k = distillPrivateKey(m.fieldTest, m.publicStrings);
      const c: MissionCard = { publicStrings: m.publicStrings, criteria: m.criteria, evidenceRequirements: m.evidenceRequirements };
      const contract = contractFor(k, c);
      for (const account of [m.publicStrings.join(" . "), ...m.voices.filter((v) => !/injection/.test(v.name)).map((v) => v.account)]) {
        const real = assembleObservationDecision({
          account,
          key: k,
          priors: [],
          judge: { obsConfidence: 0, contradictions: [], corroborations: [] },
          hasHighFraud: false,
          publicTokens: publicTokenSet(m.publicStrings),
          publicStrings: m.publicStrings,
          criterionEvidence: contract.evidence,
          criterionEvidenceDerived: contract.derived,
        });
        // an injection-shaped card is the detector's business; this compares the arithmetic
        if (real.injectionDetected) continue;
        expect(deterministicBarPass(account, k, c).pass, `${m.name}: ${account.slice(0, 40)}`).toBe(real.bar.pass);
      }
    }
  });
});

describe("try evidence: what in an answer could only come from a try", () => {
  it("counts places behind the first screen, by private words or by a phrase", () => {
    const e = tryEvidence("I chose kanban as the starting layout, then pressed copy share link.", BOARD, PLAIN.publicStrings);
    expect(e.trySources).toBe(2);
  });

  it("the first screen never counts, however exactly it is quoted", () => {
    expect(tryEvidence("It says plan anything on one board.", BOARD, PLAIN.publicStrings).trySources).toBe(0);
  });

  it("words the card already gave the tester never count", () => {
    const quoting = card(["The tester picks a starting layout kanban timeline."]);
    expect(tryEvidence("I picked a starting layout, kanban or timeline.", BOARD, quoting.publicStrings).trySources).toBe(0);
  });

  it("three details from one screen are one place", () => {
    expect(tryEvidence("Card saved. I could drag cards between columns.", BOARD, PLAIN.publicStrings).trySources).toBe(1);
  });

  it("an answer in the card's own words has a high public share; an answer in the tester's own words a low one", () => {
    const quoting = card(["The tester picks a starting layout and reports where the tester stopped."]);
    expect(tryEvidence("The tester picks a starting layout and reports where the tester stopped.", BOARD, quoting.publicStrings).publicShare).toBe(1);
    expect(tryEvidence("Honestly it felt quick, I liked the colours.", BOARD, quoting.publicStrings).publicShare).toBe(0);
  });
});

describe("the signals: three mediums, each honest alone", () => {
  const ready = missionTryReadiness(BOARD, PLAIN);
  const names = (s: BriefFraudSignal[]) => s.map((x) => x.signal);

  it("every signal is MEDIUM: none can hold a payout by itself", () => {
    const all = realTrySignals({ trySources: 0, publicShare: 0.9, contentWords: 20 }, ready, { barPass: true, deterministicSources: 1 });
    expect(names(all)).toEqual([CARD_PARROT_SIGNAL, NO_TRY_DETAIL_SIGNAL, THIN_PASS_SIGNAL]);
    expect(all.every((s) => s.severity === "med")).toBe(true);
  });

  it("a short answer is never called a parrot on its share", () => {
    expect(names(realTrySignals({ trySources: 1, publicShare: 1, contentWords: 4 }, ready, { barPass: false }))).toEqual([]);
  });

  it("'nothing from behind the first screen' needs something behind it to compare with", () => {
    const flat = { ...ready, tryOnlySources: 0 };
    expect(names(realTrySignals({ trySources: 0, publicShare: 0.2, contentWords: 20 }, flat, { barPass: false }))).toEqual([]);
  });

  it("three direct matches is not a thin pass; a criteria-complete pass and an unknown count are handled safely", () => {
    const e = { trySources: 2, publicShare: 0.2, contentWords: 20 };
    expect(names(realTrySignals(e, ready, { barPass: true, deterministicSources: 3 }))).toEqual([]);
    expect(names(realTrySignals(e, ready, { barPass: true, deterministicSources: 3, criteriaCompletePass: true }))).toEqual([THIN_PASS_SIGNAL]);
    expect(names(realTrySignals(e, ready, { barPass: true }))).toEqual([]);
    expect(names(realTrySignals(e, ready, { barPass: false, deterministicSources: 0 }))).toEqual([]);
  });
});

describe("escalateNoTry: the shape of an answer written without trying becomes one HIGH signal", () => {
  it("nothing behind the first screen + mostly the card's words", () => {
    const s = escalateNoTry([medium(NO_TRY_DETAIL_SIGNAL), medium(CARD_PARROT_SIGNAL)]);
    expect(s?.severity).toBe("high");
    expect(s?.signal).toBe(NO_TRY_SIGNAL);
    expect(s?.reason).toMatch(/names nothing Sage saw behind the first screen.*most of its words/);
    expect(s?.reason).toMatch(/nothing is refused/);
  });

  it("nothing behind the first screen + fewer than three direct matches", () => {
    expect(escalateNoTry([medium(NO_TRY_DETAIL_SIGNAL), medium(THIN_PASS_SIGNAL)])?.reason).toMatch(/fewer than three direct matches/);
  });

  it("each alone is honest and stays medium", () => {
    expect(escalateNoTry([medium(NO_TRY_DETAIL_SIGNAL)])).toBeNull();
    expect(escalateNoTry([medium(CARD_PARROT_SIGNAL)])).toBeNull();
    expect(escalateNoTry([medium(THIN_PASS_SIGNAL)])).toBeNull();
    expect(escalateNoTry([medium(CARD_PARROT_SIGNAL), medium(THIN_PASS_SIGNAL)])).toBeNull(); // it names something from a try
    expect(escalateNoTry([])).toBeNull();
  });

  it("a low-severity copy of a signal does not count", () => {
    expect(escalateNoTry([{ ...medium(NO_TRY_DETAIL_SIGNAL), severity: "low" }, medium(CARD_PARROT_SIGNAL)])).toBeNull();
  });
});

describe("judgeRealTry: the one verdict the pipeline reads", () => {
  const quoting = card([
    "The tester picks a starting layout kanban timeline.",
    "The tester sees three empty columns doing done.",
    "The tester sees card saved drag cards between columns.",
  ]);

  it("an honest answer on an autonomous mission is not held", () => {
    const v = judgeRealTry({ account: "I chose kanban as the starting layout and saw three empty columns, doing and done.", key: BOARD, card: PLAIN, pass: { barPass: true, deterministicSources: 3 } });
    expect(v.hold).toBeNull();
    expect(v.tryProven).toBe(true);
  });

  it("on a mission the card clears, an answer waits for the builder unless it proves a try", () => {
    // the card itself, sent in as the answer: all card words and nothing from a try, so it is named for what it is
    const parrot = judgeRealTry({ account: quoting.publicStrings.join(" "), key: BOARD, card: quoting, pass: { barPass: true, deterministicSources: 3 } });
    expect(parrot.hold).toBe("no_sign_of_a_try");
    expect(parrot.signals.map((s) => s.signal)).toEqual([CARD_PARROT_SIGNAL, NO_TRY_DETAIL_SIGNAL, NO_TRY_SIGNAL]);
    const tried = judgeRealTry({ account: "Got the columns, pressed copy share link, then opened the template gallery for sprint planning.", key: BOARD, card: quoting, pass: { barPass: true, deterministicSources: 3 } });
    expect(tried.evidence.trySources).toBeGreaterThanOrEqual(TRY_PROVEN_SOURCES);
    expect(tried.hold).toBeNull();
  });

  it("one place behind the first screen is not enough on such a mission: never a single lucky phrase", () => {
    const one = judgeRealTry({ account: "Got the columns and pressed copy share link at the end.", key: BOARD, card: quoting, pass: { barPass: true, deterministicSources: 3 } });
    expect(one.evidence.trySources).toBe(1);
    expect(one.hold).toBe("public_overlap");
  });

  it("the HIGH signal outranks the mission's reason, and both mediums stay listed beside it", () => {
    const v = judgeRealTry({ account: "It says plan anything on one board and everything went fine for me, start to finish.", key: BOARD, card: PLAIN, pass: { barPass: true, deterministicSources: 1 } });
    expect(v.hold).toBe("no_sign_of_a_try");
    expect(v.signals.map((s) => s.signal)).toEqual([NO_TRY_DETAIL_SIGNAL, THIN_PASS_SIGNAL, NO_TRY_SIGNAL]);
  });

  it("the calibration record is counts, a share and names: never a word of the key", () => {
    const v = judgeRealTry({ account: "I chose kanban as the starting layout, then pressed copy share link.", key: BOARD, card: PLAIN, pass: { barPass: true, deterministicSources: 2 } });
    const out = JSON.stringify(realTryShadow(v));
    for (const o of BOARD.observations) expect(out).not.toContain(o.text);
    expect(realTryShadow(v)).toMatchObject({ cardClears: false, tryOnlySources: 5, trySources: 2, hold: null });
  });

  it("the builder's line is calm, says who is still paid, and names nothing from the key", () => {
    expect(RELEASE_LINE).toMatch(/^Sage may ask you to release answers to this mission/);
    expect(RELEASE_LINE).toMatch(/still paid without you/);
    expect(RELEASE_LINE).not.toMatch(/—|fraud|reject|refus/i);
  });
});
