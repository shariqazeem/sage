import { describe, expect, it } from "vitest";

import {
  detectGatedActions,
  buildGatedActionMission,
  findGateAnchor,
  alreadyCovered,
  type GatedAction,
} from "./gated-action-mission";
import { classifyVerifiability, anchorIssues, validatePlanMissions } from "./validate-mission";

/**
 * THE WORK SAGE CANNOT DO IS EXACTLY THE WORK A PAID TESTER IS FOR.
 *
 * Measured live on clawup.org, $400 budget, goal: "testers must launch an agent, which requires
 * purchasing credits and paying for compute with their own money". Sage inspected eight pages,
 * compiled nine checkpoints, and returned one mission: **Validate Logo Safety Zone Compliance**.
 * The founder asked about their product's core flow and got its brand guidelines page, because that
 * was the part Sage could witness by itself.
 *
 * The two failure modes this sits between are both real and both bad. Invent a paid step nobody
 * asked for and you kill the plan (that is what `intent-guard` exists to prevent). Refuse to plan
 * one the founder DID ask for and you hand them a logo mission for $400.
 */

/** The observed lines a run like clawup's actually produces — a mix of controls and prose. */
const OBSERVED = [
  "ClawUp",
  "Buy credits",
  "Pricing",
  "Start building agents today",
  "Credits are used for compute time on your running agents",
  "Docs",
  "Logo safety zone",
];

const GOAL =
  "Testers must launch an agent on ClawUp. This requires purchasing credits and paying for compute, which the tester does with their own money.";

describe("only what the founder actually asked for", () => {
  it("finds the paid step the founder named", () => {
    const found = detectGatedActions(GOAL, OBSERVED);
    expect(found.map((a) => a.family)).toContain("payment");
    const pay = found.find((a) => a.family === "payment")!;
    // The founder's own sentence, verbatim — never Sage's paraphrase of it.
    expect(GOAL).toContain(pay.sourcePhrase.slice(0, 40));
  });

  it("does NOT invent a paid step the founder never mentioned", () => {
    // This is the exact failure intent-guard was written for, from the other direction.
    const found = detectGatedActions(
      "Check that a first-time visitor can find the docs and read the quickstart.",
      OBSERVED,
    );
    expect(found).toEqual([]);
  });

  it("does not claim a gate it never saw", () => {
    // The founder asked, but Sage never reached a purchase surface. An unanchored mission cannot
    // exist, and asserting one anyway is how a plan claims work nobody can verify.
    const found = detectGatedActions(GOAL, ["Home", "About us", "Careers"]);
    expect(found).toEqual([]);
  });

  it("returns at most one mission per family", () => {
    const found = detectGatedActions(
      "Testers should buy credits, purchase a plan, and top up their balance.",
      OBSERVED,
    );
    expect(found.filter((a) => a.family === "payment")).toHaveLength(1);
  });

  it("handles an empty or missing goal without inventing anything", () => {
    expect(detectGatedActions("", OBSERVED)).toEqual([]);
    expect(detectGatedActions(null, OBSERVED)).toEqual([]);
    expect(detectGatedActions(undefined, OBSERVED)).toEqual([]);
  });

  it("prefers a control over a paragraph as the anchor", () => {
    const re = /\b(purchas\w+|buy(?:ing)?|credits?)\b/i;
    // "Buy credits" is a doorway; the sentence about compute time is a description of one.
    expect(findGateAnchor(OBSERVED, re)).toBe("Buy credits");
  });
});

describe("the mission survives the real gates", () => {
  const action = detectGatedActions(GOAL, OBSERVED).find((a) => a.family === "payment")!;
  const mission = buildGatedActionMission(action, {
    targetSurface: "https://clawup.org/pricing",
    productName: "ClawUp",
  });

  it("classifies as url-verifiable, which is the only lane that can judge it", () => {
    // Sage has no corpus for a screen it never loaded, so observation-based here is unjudgeable.
    // This is a deterministic regex gate over the mission's own text — it either reads as
    // reach-a-url-and-quote-text or it does not.
    expect(classifyVerifiability(mission)).toBe("url-verifiable");
  });

  // `buildObservationCorpus` returns a NORMALIZED blob (lowercased, whitespace collapsed) and the
  // anchor gate compares against it directly, so a test that passes raw text is testing nothing.
  const corpusOf = (lines: string[]) => lines.join(" • ").toLowerCase().replace(/\s+/g, " ").trim();

  it("anchors on text Sage genuinely observed", () => {
    expect(anchorIssues(mission, corpusOf(OBSERVED))).toEqual([]);
  });

  it("is refused by the anchor gate if the anchor is not really in the corpus", () => {
    // Proving the previous test means something.
    expect(anchorIssues(mission, corpusOf(["Home", "About us", "Careers"])).length).toBeGreaterThan(0);
  });
});

describe("the mission is honest with the person doing it", () => {
  const pay = buildGatedActionMission(
    { family: "payment", sourcePhrase: "testers must buy credits", gateAnchor: "Buy credits" },
    { targetSurface: "https://x.test/pricing" },
  );

  it("says plainly that the tester spends their own money", () => {
    expect(pay.instructions).toMatch(/your own money/i);
    expect(pay.conditions.join(" ")).toMatch(/payment method/i);
  });

  it("never asks for a password, a key, or a recovery phrase", () => {
    const all = `${pay.instructions} ${pay.criteria.join(" ")} ${pay.evidenceRequirements.join(" ")}`;
    expect(all).not.toMatch(/\b(password|private key|seed phrase|recovery phrase)\b/i);
    expect(pay.disallowed.join(" ")).toMatch(/private keys/i);
  });

  it("quotes the founder's own words as the reason it exists", () => {
    expect(pay.whyItMatters).toContain("testers must buy credits");
  });

  it("asks for an artifact, not an impression", () => {
    expect(pay.evidenceRequirements.join(" ")).toMatch(/url/i);
    expect(pay.evidenceRequirements.join(" ")).toMatch(/heading|line of text/i);
  });
});

describe("harder work is priced as harder work", () => {
  const mk = (family: GatedAction["family"]) =>
    buildGatedActionMission(
      { family, sourcePhrase: "x", gateAnchor: "Buy credits" },
      { targetSurface: "https://x.test" },
    );

  it("a paid step costs a tester more time than an approval click", () => {
    expect(mk("payment").effortMinutes).toBeGreaterThan(mk("approval").effortMinutes);
  });

  it("asks for more than one tester, so a paid flow is not proven by a single person", () => {
    // It is high-priority, which makes it the compiler's balancer; a cap of 1 meant it swallowed the
    // whole remainder into one reward — $118.62 on a live $430 run.
    expect(mk("payment").maxCompletions).toBeGreaterThan(1);
  });

  it("carries a higher reward weight than an ordinary mission", () => {
    // The compiler turns weight into money; this is how difficulty reaches the tester's pocket.
    expect(mk("payment").rewardWeight).toBeGreaterThan(5);
  });

  it("every family produces a positive, sane effort estimate", () => {
    for (const f of ["payment", "account", "wallet", "approval"] as const) {
      expect(mk(f).effortMinutes).toBeGreaterThan(0);
      expect(mk(f).effortMinutes).toBeLessThanOrEqual(60);
    }
  });
});

describe("it does not duplicate work the architect already planned", () => {
  const action: GatedAction = {
    family: "payment",
    sourcePhrase: "buy credits",
    gateAnchor: "Buy credits",
  };

  it("stands down when a mission already covers the action", () => {
    expect(
      alreadyCovered(action, [
        { title: "Purchase credits", objective: "Buy a credit pack", criteria: ["credits appear"] },
      ]),
    ).toBe(true);
  });

  it("steps in when nothing covers it", () => {
    expect(
      alreadyCovered(action, [
        { title: "Read the docs", objective: "Open the quickstart", criteria: ["the page loads"] },
      ]),
    ).toBe(false);
  });
});

describe("it must survive the FULL validator, not just the parts I remembered", () => {
  const scope = {
    knownUrls: new Set(["https://clawup.org", "https://clawup.org/"]),
    hosts: new Set(["clawup.org"]),
    repoPaths: new Set<string>(),
  };
  // The real notable-element texts recorded from clawup.org, lowercased as the corpus stores them.
  const REAL_LINES = [
    "clawup — build and power up your ai agent",
    "works with leading agent frameworks",
    "simple, pay-as-you-go pricing",
    "sign in / sign up",
    "user guide",
  ];

  it("passes validatePlanMissions end to end on a real product's lines", () => {
    // The mission was built correctly and ANCHORED correctly and still never reached the founder:
    // it cited no source, so the validator dropped it with `unknown_source_ref` — in silence,
    // exactly as that drop is designed to behave. Anchors alone are not the gate.
    const action = detectGatedActions(GOAL, REAL_LINES).find((a) => a.family === "payment")!;
    expect(action.gateAnchor).toBe("simple, pay-as-you-go pricing");
    const m = buildGatedActionMission(action, {
      targetSurface: "https://clawup.org",
      productName: "ClawUp",
    });
    const [report] = validatePlanMissions([m], scope as never, REAL_LINES.join(" • "), undefined);
    expect(report.issues.map((i) => i.code)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("cites the gate line it actually read, on the page it read it", () => {
    const m = buildGatedActionMission(
      { family: "payment", sourcePhrase: "buy credits", gateAnchor: "simple, pay-as-you-go pricing" },
      { targetSurface: "https://clawup.org" },
    );
    expect(m.sources).toHaveLength(1);
    expect(m.sources[0]!.kind).toBe("page");
    expect(m.sources[0]!.ref).toBe("https://clawup.org");
    expect(m.sources[0]!.observation).toBe("simple, pay-as-you-go pricing");
  });
});
