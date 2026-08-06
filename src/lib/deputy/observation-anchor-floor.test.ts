import { describe, it, expect } from "vitest";

import { assembleObservationDecision } from "./observation-judge";
import { OBS_BAR, type PrivateKey } from "./observation-verify";

/**
 * THE ANCHOR FLOOR MUST REACH THE BAR, NOT JUST EXIST.
 *
 * `observationBar` applies the floor only when the caller supplies `deterministicSources`, because
 * an older caller that cannot compute the split must keep its previous behaviour rather than be
 * held by default. That kindness is also a trapdoor: the floor is a no-op for any caller that stops
 * passing the field, and TypeScript cannot see it because the field is optional.
 *
 * It has already happened once. A refactor dropped `deterministicSources` and `phraseAnchors` from
 * the signals `assembleObservationDecision` builds. Everything type-checked, the whole suite stayed
 * green, and the floor was silently dead in the one place that gates real money.
 *
 * What that costs is specific. `validateCorroborations` deliberately imposes NO lexical requirement
 * against the corpus, because a true semantic bridge shares no words with it ("she talked to me" ↔
 * "…speaking to the player"). Its safety comes from the verbatim pair, the distinct-source count,
 * and THIS floor. Remove the floor and three model-bridged corroborations clear the bar on their
 * own: the model becomes the sole basis for a payout, which is the one thing it may never be.
 *
 * These tests drive the real assembler, not the bar directly, because the bar was never the part
 * that broke.
 */

const key: PrivateKey = {
  observations: [
    { source: "heading:0", text: "the chain decides every dollar it spends" },
    { source: "heading:1", text: "a device you own workers that earn money you control" },
    { source: "copy:0", text: "earnings tick up while you watch the dashboard" },
    { source: "copy:1", text: "atlas has been live for one hundred and seven days" },
    { source: "action:0", text: "see atlas live for pay dot sh buyers" },
    { source: "claim:0", text: "agents with private keys can steal everything" },
  ],
  distinctSources: 6,
  digest: "0xkey",
};

/** An account written by someone who never opened the product: fluent, plausible, zero product words. */
const FABRICATED =
  "I used the platform and it was really smooth overall. The onboarding felt clear, everything " +
  "loaded quickly, and I could find what I needed without any confusion. Solid experience.";

const assemble = (
  account: string,
  judge: {
    obsConfidence: number;
    contradictions: never[];
    corroborations: { accountQuote: string; corpusQuote: string; criterionId?: string }[];
  },
) =>
  assembleObservationDecision({
    account,
    key,
    publicTokens: new Set<string>(),
    publicStrings: [],
    priors: [],
    judge,
    hasHighFraud: false,
  });

describe("the floor reaches the bar", () => {
  it("a fabrication with no product words is refused for MISSING AN ANCHOR, not merely for thin counts", () => {
    const d = assemble(FABRICATED, { obsConfidence: 0.95, contradictions: [], corroborations: [] });

    expect(d.bar.pass).toBe(false);
    // The distinction is the whole point. `few_matches` alone is overridable by the
    // criteria-complete pass; `no_product_anchor` is not. If this ever reports only the former,
    // the floor is no longer being applied.
    expect(d.bar.reasons.join(",")).toMatch(/no_product_anchor/);
  });

  it("the assembler actually computes the split the floor reads", () => {
    // The structural half: the fields exist on the decision, so a future refactor that drops them
    // fails here instead of silently disarming the gate.
    const d = assemble(FABRICATED, { obsConfidence: 0, contradictions: [], corroborations: [] });
    expect(typeof d.phraseAnchors).toBe("number");
    expect(typeof d.corpusMatch.distinctSources).toBe("number");
    expect(d.phraseAnchors).toBe(0);
    expect(d.corpusMatch.distinctSources).toBe(0);
  });
});

describe("model bridges alone can never buy a payout", () => {
  it("three VALIDATED corroborations, zero deterministic anchors, still does not pass", () => {
    // Each corroboration is legitimate by the corroboration validator's own rules: the account quote
    // is a verbatim substring of the account carrying non-public words, and the corpus quote is a
    // verbatim substring of a real observation. Three distinct sources is exactly the flat bar. The
    // ONLY thing standing between this and an autopay is the anchor floor.
    const account =
      "I wandered around for a while and the little machine kept adding to its total by itself. " +
      "Nobody handed it my secrets, which is the part I actually cared about. It ran for months apparently.";

    const d = assemble(account, {
      obsConfidence: 0.95,
      contradictions: [],
      corroborations: [
        { accountQuote: "kept adding to its total by itself", corpusQuote: "earnings tick up" },
        { accountQuote: "nobody handed it my secrets", corpusQuote: "agents with private keys" },
        { accountQuote: "it ran for months apparently", corpusQuote: "atlas has been live" },
      ],
    });

    // The bridges were accepted as bridges...
    expect(d.validatedCorroborations.length).toBe(3);
    expect(d.publicView.distinctSources).toBeGreaterThanOrEqual(OBS_BAR.minDistinctMatches);
    // ...and the payout is still refused, because nothing the tester wrote came from inside the product.
    expect(d.corpusMatch.distinctSources).toBe(0);
    expect(d.phraseAnchors).toBe(0);
    expect(d.bar.pass).toBe(false);
    expect(d.bar.reasons.join(",")).toMatch(/no_product_anchor/);
  });

  it("the same bridges DO pay once one real product phrase is present", () => {
    // The floor is a floor, not a wall. Add one thing only a visitor could write and the same
    // account clears, which is what keeps the genuine paraphrasing tester paid.
    const account =
      "I wandered around for a while and the little machine kept adding to its total by itself. " +
      "Nobody handed it my secrets, which is the part I actually cared about. It ran for months apparently. " +
      "The screen said earnings tick up while you watch the dashboard.";

    const d = assemble(account, {
      obsConfidence: 0.95,
      contradictions: [],
      corroborations: [
        { accountQuote: "kept adding to its total by itself", corpusQuote: "earnings tick up" },
        { accountQuote: "nobody handed it my secrets", corpusQuote: "agents with private keys" },
        { accountQuote: "it ran for months apparently", corpusQuote: "atlas has been live" },
      ],
    });

    expect(d.phraseAnchors).toBeGreaterThanOrEqual(OBS_BAR.minPhraseAnchors);
    expect(d.bar.reasons.join(",")).not.toMatch(/no_product_anchor/);
    expect(d.bar.pass).toBe(true);
  });
});
