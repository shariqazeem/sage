import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { runObservationDecision } from "./observation-judge";
import { OBS_BAR, OBS_MAX_ATTEMPTS, deriveCriterionEvidence, type PrivateKey } from "./observation-verify";
import { observationRetryLine, reasonSentence } from "./reason-copy";

/**
 * THE DRILL — the tester experience we are about to sell to strangers, run end to end before one of
 * them runs it by accident.
 *
 * Of the eleven submissions Sage has ever judged, every single one is `attempt 1`, and all three
 * rejections were operational (a stale test, two stranded by a stopped campaign). So the sequence in
 * the marketing copy — "if it holds you, it tells you what was missing so you can add it" — had
 * never happened to anybody. The retry loop, the coaching line, and the pass-after-revision were
 * all untested against a real judge.
 *
 * This runs the REAL judgment path (deterministic corpus match, injection, near-dup, and the actual
 * LLM judge) over a REAL corpus lifted from a live campaign, and stops short of settlement. No money
 * moves, no wallet is needed, and nothing is written to a database — which is the point: the
 * expensive part of the payout question is the judgment, and the judgment can be exercised alone.
 *
 * LIVE and costs tokens, so it is gated:
 *   PAYOUT_DRILL=1 npx vitest run src/lib/deputy/payout-drill.live.test.ts
 *
 * What must hold, in the order a tester experiences it:
 *   1. a thin, honest first try is HELD, and held as RETRYABLE — not as fraud
 *   2. the coaching it produces is real guidance, not a verdict on the person
 *   3. a fabrication from someone who never opened the product is refused, and stays refused
 *   4. the revised, specific account CLEARS the bar
 */

const LIVE = process.env.PAYOUT_DRILL === "1";
const d = LIVE ? describe : describe.skip;

const fixture = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "live-corpus-yara.json"), "utf8"),
) as {
  campaignId: string;
  digest: string;
  distinctSources: number;
  observations: { source: string; text: string }[];
  mission: {
    title: string;
    objective: string;
    instructions: string;
    targetSurface: string;
    criteria: string[];
    evidenceList: string[];
  };
};

const key: PrivateKey = {
  observations: fixture.observations,
  distinctSources: fixture.distinctSources,
  digest: fixture.digest,
};

const publicStrings = [
  fixture.mission.title,
  fixture.mission.objective,
  fixture.mission.instructions,
  fixture.mission.targetSurface,
  ...fixture.mission.criteria,
  ...fixture.mission.evidenceList,
];

/**
 * The mission's own criterion contract, built EXACTLY as `runDeputyOnSubmission` builds it: the
 * compiler-pinned one when it exists, else one derived from the pinned key. Omitting this made the
 * drill a weaker judge than production and produced a false alarm — every live mission today has
 * `criterion_evidence: NULL`, so the derived branch is the one that actually runs.
 */
const criterionContract = (() => {
  const derived = deriveCriterionEvidence(key, fixture.mission.criteria, fixture.mission.evidenceList);
  return derived.some((c) => c.keySources.length > 0)
    ? { evidence: derived, derived: true }
    : { evidence: null, derived: false };
})();

const judge = (account: string) =>
  runObservationDecision({
    account,
    key,
    priors: [],
    missionObjective: fixture.mission.objective,
    criteria: fixture.mission.criteria,
    hasHighFraud: false,
    publicStrings,
    criterionEvidence: criterionContract.evidence,
    criterionEvidenceDerived: criterionContract.derived,
    model: process.env.OBS_JUDGE_MODEL || undefined,
  });

/** The classification the pipeline makes from a decision — mirrors runDeputyOnSubmission's branch. */
function classify(dec: Awaited<ReturnType<typeof judge>>, attempt: number) {
  const fraudFlagged = dec.injectionDetected || dec.bar.reasons.includes("high_fraud");
  const retryable = !dec.bar.pass && !fraudFlagged && attempt < OBS_MAX_ATTEMPTS;
  return {
    pass: dec.bar.pass,
    retryable,
    fraudFlagged,
    line: retryable
      ? observationRetryLine(attempt, OBS_MAX_ATTEMPTS)
      : reasonSentence(dec.bar.pass ? "observation_verified" : "observation_review"),
  };
}

const show = (label: string, dec: Awaited<ReturnType<typeof judge>>, c: ReturnType<typeof classify>) => {
  console.log(
    `\n  ${label}\n` +
      `    bar.pass=${dec.bar.pass} reasons=[${dec.bar.reasons.join(", ")}]\n` +
      `    deterministic=${dec.corpusMatch.distinctSources} phraseAnchors=${dec.phraseAnchors} ` +
      `corroborated=${dec.validatedCorroborations.length} obsConfidence=${dec.obsConfidence}\n` +
      `    retryable=${c.retryable} fraudFlagged=${c.fraudFlagged}\n` +
      `    tester sees: ${c.line}`,
  );
};

d("the drill: hold, coach, revise, clear", () => {
  it(
    "a thin but honest first try is held as RETRYABLE, never as fraud",
    async () => {
      const thin = "I opened it and had a look around. It was nice and calm. I found what I needed.";
      const dec = await judge(thin);
      const c = classify(dec, 1);
      show("attempt 1 — thin", dec, c);

      expect(dec.bar.pass).toBe(false);
      // The distinction that decides whether a real person comes back: thin is not dishonest.
      expect(c.fraudFlagged).toBe(false);
      expect(c.retryable).toBe(true);
      expect(c.line.length).toBeGreaterThan(20);
    },
    120_000,
  );

  it(
    "a fabrication is refused, and refusing it does not depend on the model",
    async () => {
      const fake =
        "I used the platform and it was really smooth overall. The onboarding was clear, the " +
        "dashboard loaded fast, and everything I needed was in one place. A polished product.";
      const dec = await judge(fake);
      const c = classify(dec, 1);
      show("fabrication", dec, c);

      expect(dec.bar.pass).toBe(false);
      // The anchor floor is what makes this structural: nothing in the account came from inside
      // the product, so no amount of model enthusiasm can carry it.
      expect(dec.corpusMatch.distinctSources + dec.phraseAnchors).toBe(0);
    },
    120_000,
  );

  it(
    "the revised, specific account CLEARS the bar",
    async () => {
      // What a real person writes after being told to name what they saw. Every phrase here is
      // something the product actually shows, which is exactly the bar's premise.
      const revised =
        "I landed in a gentle world to heal and followed today's path. I wandered past the still " +
        "pond and the fountain plaza, then through the lantern grove until I reached Yara's grove. " +
        "I found Yara there and started talking to her, and she answered me with something new that " +
        "was not on the screen before.";
      const dec = await judge(revised);
      const c = classify(dec, 2);
      show("attempt 2 — revised", dec, c);

      expect(dec.corpusMatch.distinctSources).toBeGreaterThanOrEqual(OBS_BAR.minDeterministicSources);
      expect(dec.bar.pass).toBe(true);
      expect(dec.bar.reasons).toEqual([]);
    },
    120_000,
  );

  it(
    "parroting the mission card back earns nothing",
    async () => {
      const dec = await judge(fixture.mission.criteria.join(" ") + " " + fixture.mission.objective);
      const c = classify(dec, 1);
      show("parrot", dec, c);
      expect(dec.bar.pass).toBe(false);
    },
    120_000,
  );
});

/**
 * THE PERSON THIS HAS TO BE FAIR TO.
 *
 * The people most likely to do a $0.50 mission are not fluent technical writers. If the judge is
 * really scoring English rather than evidence, it will pay the articulate and hold the beginner for
 * doing the identical work — which is both unfair and, for a marketplace that recruits strangers,
 * fatal. The bar is supposed to be evidence-shaped, not prose-shaped. These check that it is.
 */
d("fair to a beginner, not just to a good writer", () => {
  it(
    "rough, broken English with real observations CLEARS",
    async () => {
      const rough =
        "i open the site. it say a gentle world to heal. i see today s path and i go. there is still " +
        "pond and fountain plaza. after i walk lantern grove then i reach yara s grove. i find yara " +
        "and i talk her. she reply me new thing what is not before on screen.";
      const dec = await judge(rough);
      const c = classify(dec, 1);
      show("rough English", dec, c);
      expect(dec.bar.pass).toBe(true);
    },
    120_000,
  );

  it(
    "very short but specific CLEARS, because concision is not absence of evidence",
    async () => {
      const terse =
        "still pond, fountain plaza, lantern grove, then yara s grove. talked to Yara, she answered " +
        "something new that was not on screen before.";
      const dec = await judge(terse);
      const c = classify(dec, 1);
      show("terse but specific", dec, c);
      expect(dec.bar.pass).toBe(true);
    },
    120_000,
  );

  it(
    "polished, fluent, and empty is REFUSED — the mirror image of the test above",
    async () => {
      const eloquent =
        "What struck me most was the restraint of the whole experience. The pacing invites you to " +
        "slow down, the visual language is coherent throughout, and the interaction model rewards " +
        "patience in a way that feels genuinely considered. A quietly confident piece of design.";
      const dec = await judge(eloquent);
      const c = classify(dec, 1);
      show("fluent but empty", dec, c);
      expect(dec.bar.pass).toBe(false);
    },
    120_000,
  );
});
