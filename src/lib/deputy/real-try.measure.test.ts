import { describe, expect, it } from "vitest";
import { assembleObservationDecision, type ObservationJudgeResult } from "./observation-judge";
import { contentTokens, distillPrivateKey, normObs, publicTokenSet, type PrivateKey } from "./observation-verify";
import { PARROT_PUBLIC_SHARE, contractFor, judgeRealTry, type MissionCard } from "./real-try";
import { realTryMissions, type RealTryMission, type RealTryVoice } from "./real-try-fixtures";

/**
 * THE OFFLINE MEASURE: every voice on every fixture mission, through the real deterministic layers
 * (the matcher, the bar, the real-try gate), with no model and no network.
 *
 * Each voice is run twice:
 *   - "silent model": the judge returns nothing, so only arithmetic decides;
 *   - "willing model": a stand-in judge that offers a corroboration for EVERY sentence of the answer
 *     against EVERY source in the key. No real model is this credulous. It is the worst case for the
 *     one part of the judgment that is not arithmetic, so "junk is never paid" is measured against it.
 *
 * Outcomes: `paid` (Sage pays alone), `held` (waits for the builder, or for the tester to add detail).
 * There is no refusal in this lane, and the assertions below keep it that way.
 *
 * `REAL_TRY_TABLE=1 npx vitest run real-try.measure` prints the table.
 */

type Outcome = "paid" | "held: below the bar" | "held: no sign of a try" | "held: public mission";

const silent: ObservationJudgeResult = { obsConfidence: 0, contradictions: [], corroborations: [] };

function willing(account: string, key: PrivateKey): ObservationJudgeResult {
  const sentences = account
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => contentTokens(normObs(s)).length >= 2);
  const firstBySource = new Map<string, string>();
  for (const o of key.observations) if (!firstBySource.has(o.source) && contentTokens(o.text).length >= 2) firstBySource.set(o.source, o.text);
  const corroborations = [...firstBySource.values()].flatMap((corpusQuote, i) => (sentences.length > 0 ? [{ accountQuote: sentences[i % sentences.length]!, corpusQuote }] : []));
  return { obsConfidence: 0.95, contradictions: [], corroborations };
}

interface Row {
  mission: string;
  voice: RealTryVoice;
  silent: Outcome;
  willing: Outcome;
  sources: number;
  trySources: number;
  share: number;
}

function keyOf(m: RealTryMission): PrivateKey {
  return distillPrivateKey(m.fieldTest, m.publicStrings);
}
const cardOf = (m: RealTryMission): MissionCard => ({ publicStrings: m.publicStrings, criteria: m.criteria, evidenceRequirements: m.evidenceRequirements });

function decide(m: RealTryMission, key: PrivateKey, account: string, judge: ObservationJudgeResult) {
  const card = cardOf(m);
  const contract = contractFor(key, card);
  const d = assembleObservationDecision({
    account,
    key,
    priors: [],
    judge,
    hasHighFraud: false,
    publicTokens: publicTokenSet(m.publicStrings),
    publicStrings: m.publicStrings,
    criterionEvidence: contract.evidence,
    criterionEvidenceDerived: contract.derived,
  });
  const rt = judgeRealTry({
    account,
    key,
    card,
    pass: { barPass: d.bar.pass, deterministicSources: d.corpusMatch.distinctSources, criteriaCompletePass: d.criteriaCompletePass },
  });
  const outcome: Outcome = !d.bar.pass ? "held: below the bar" : rt.hold === "no_sign_of_a_try" ? "held: no sign of a try" : rt.hold === "public_overlap" ? "held: public mission" : "paid";
  return { d, rt, outcome };
}

const rows: Row[] = [];
const readiness: { mission: string; keySources: number; cardSources: number; cardClears: boolean; tryOnlySources: number; autonomous: boolean }[] = [];
for (const m of realTryMissions) {
  const key = keyOf(m);
  const first = decide(m, key, "", silent).rt.readiness;
  readiness.push({ mission: m.name, ...first });
  for (const voice of m.voices) {
    const s = decide(m, key, voice.account, silent);
    const w = decide(m, key, voice.account, willing(voice.account, key));
    rows.push({ mission: m.name, voice, silent: s.outcome, willing: w.outcome, sources: s.d.corpusMatch.distinctSources, trySources: s.rt.evidence.trySources, share: s.rt.evidence.publicShare });
  }
}

if (process.env.REAL_TRY_TABLE === "1") {
  console.log("\nMISSION READINESS (the card submitted as the answer, and what only a try reveals)");
  for (const r of readiness)
    console.log(`  ${r.mission.padEnd(36)} key ${r.keySources} sources · the card matches ${r.cardSources} · clears the bar: ${String(r.cardClears).padEnd(5)} · try-only sources ${r.tryOnlySources} · autonomous: ${r.autonomous}`);
  console.log("\nmission                              voice                   is      matched try share  silent model            willing model");
  for (const r of rows)
    console.log(
      `${r.mission.padEnd(36)} ${r.voice.name.padEnd(23)} ${(r.voice.honest ? "honest" : "junk").padEnd(7)} ${String(r.sources).padEnd(7)} ${String(r.trySources).padEnd(3)} ${r.share.toFixed(2)}   ${r.silent.padEnd(23)} ${r.willing}`,
    );
  const tally = (honest: boolean, pick: (r: Row) => Outcome) => {
    const set = rows.filter((r) => r.voice.honest === honest);
    return `${set.filter((r) => pick(r) === "paid").length} paid, ${set.filter((r) => pick(r) !== "paid").length} held, of ${set.length}`;
  };
  console.log(`\nHONEST  silent model: ${tally(true, (r) => r.silent)} · willing model: ${tally(true, (r) => r.willing)} · refused: 0`);
  console.log(`JUNK    silent model: ${tally(false, (r) => r.silent)} · willing model: ${tally(false, (r) => r.willing)}\n`);
}

const find = (mission: string, voice: string) => rows.find((r) => r.mission.startsWith(mission) && r.voice.name === voice)!;

describe("a real try, measured offline", () => {
  it("junk is never paid: not by arithmetic alone, and not with a model willing to bridge anything", () => {
    const paid = rows.filter((r) => !r.voice.honest && (r.silent === "paid" || r.willing === "paid"));
    expect(paid.map((r) => `${r.mission} / ${r.voice.name}`)).toEqual([]);
  });

  it("an honest answer is paid or held, never refused", () => {
    for (const r of rows.filter((x) => x.voice.honest)) {
      expect(["paid", "held: below the bar", "held: no sign of a try", "held: public mission"]).toContain(r.silent);
    }
  });

  it("rich missions are untouched: they stay autonomous and their honest answers are paid as before", () => {
    for (const name of ["yara", "excalidraw"]) {
      expect(readiness.find((r) => r.mission === name)!.autonomous).toBe(true);
    }
    expect(find("yara", "genuine-yara").silent).toBe("paid");
    expect(find("excalidraw", "genuine-excalidraw").silent).toBe("paid");
  });

  it("the mission that leaked on 12 Aug is not autonomous: the card alone clears its bar", () => {
    const r = readiness.find((x) => x.mission.startsWith("frameworks"))!;
    expect(r.cardClears).toBe(true);
    expect(r.autonomous).toBe(false);
    // the two that leaked: both cleared the bar then, and neither is paid now
    expect(find("frameworks", "card-parrot").willing).not.toBe("paid");
    expect(find("frameworks", "wrong-product").willing).not.toBe("paid");
  });

  it("the core first-try mission: an honest answer naming screens behind the first one is paid, even where the card itself clears the bar", () => {
    // On this product the fixed words happen to match two of Sage's screens ("name your board"), and with
    // every criterion evidenced that clears the bar: the card, sent in as the answer, would have been paid.
    const r = readiness.find((x) => x.mission === "core first try")!;
    expect(r.cardClears).toBe(true);
    expect(r.autonomous).toBe(false);
    // ...and still the honest answers that name what is behind the first screen are paid by Sage alone
    expect(find("core", "finished").silent).toBe("paid");
    expect(find("core", "stopped-midway").silent).toBe("paid");
    expect(find("core", "own-words").silent).toBe("paid");
    // never left the first screen: Sage cannot tell this from reading the page, so the builder releases it
    expect(find("core", "stuck-on-first-screen").silent).not.toBe("paid");
    for (const junk of ["card-parrot", "page-only", "page-only-own-filler"]) expect(find("core", junk).willing).not.toBe("paid");
  });

  it("the parrot share separates: every honest answer is under the line, every card parrot and plain page-only answer over it", () => {
    const honest = rows.filter((r) => r.voice.honest).map((r) => r.share);
    const parrots = rows.filter((r) => r.voice.kind === "card parrot" || r.voice.kind === "parrot" || r.voice.kind === "card-parrot" || r.voice.kind === "page-only").map((r) => r.share);
    expect(parrots.length).toBeGreaterThanOrEqual(6);
    expect(Math.max(...honest)).toBeLessThan(PARROT_PUBLIC_SHARE);
    expect(Math.min(...parrots)).toBeGreaterThan(PARROT_PUBLIC_SHARE);
  });

  it("a held answer always carries its reason, and the reason carries no words from the key", () => {
    for (const m of realTryMissions) {
      const key = keyOf(m);
      for (const voice of m.voices) {
        const { rt } = decide(m, key, voice.account, silent);
        for (const s of rt.signals) {
          for (const o of key.observations) expect(s.reason.toLowerCase()).not.toContain(o.text);
        }
      }
    }
  });
});
