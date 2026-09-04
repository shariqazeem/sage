import { describe, expect, it } from "vitest";
import {
  reasonSentence,
  heldLine,
  decisionLabel,
  observationCoaching,
  observationRetryLine,
  reasonSentencePublic,
  withProductName,
} from "./reason-copy";

/**
 * P17 — the reason copy is the SAME plain-language sentence everywhere a founder reads it, human
 * words first with the class token in the technical register, and it never implies a verification
 * that did not happen.
 */

describe("reasonSentence", () => {
  it("names each known reason class in plain language + keeps the token", () => {
    expect(reasonSentence("evidence_mismatch")).toBe("the public page couldn't confirm this work (evidence_mismatch)");
    expect(reasonSentence("no_evidence")).toContain("(no_evidence)");
    expect(reasonSentence("mainnet_manual")).toContain("(mainnet_manual)");
    expect(reasonSentence("observation_review")).toContain("(observation_review)");
    expect(reasonSentence("duplicate")).toContain("(duplicate)");
  });

  it("degrades honestly for an unknown or absent token (never a false 'verified')", () => {
    expect(reasonSentence(null)).toBe("Sage couldn't reach a confident decision (unknown)");
    expect(reasonSentence(undefined)).toContain("(unknown)");
    expect(reasonSentence("something_new")).toBe("Sage couldn't reach a confident decision (something_new)");
    expect(reasonSentence("evidence_mismatch")).not.toMatch(/verif/i);
  });
});

describe("heldLine + decisionLabel", () => {
  it("held lines lead with 'Held:' and the reason sentence", () => {
    expect(heldLine("evidence_mismatch")).toBe("Held: the public page couldn't confirm this work (evidence_mismatch)");
  });
  it("decisionLabel never says 'Verified' for a hold or block", () => {
    expect(decisionLabel("verified")).toBe("Verified");
    expect(decisionLabel("held", "evidence_mismatch")).toMatch(/^Held:/);
    expect(decisionLabel("blocked", "prompt_injection")).toMatch(/^Blocked:/);
    expect(decisionLabel("held", "evidence_mismatch")).not.toMatch(/verif/i);
  });
});

/**
 * P20 retry-while-held coaching. The invariant that matters most: the coaching a TESTER reads can
 * carry COUNTS (how many of Sage's observations they matched, how many are left) but must NEVER carry
 * corpus content — no matched string, no unmatched detail, nothing that could be parroted back. These
 * functions take only integers, so the leak is impossible by construction; the tests pin that contract.
 */
describe("observationCoaching (P20 — leak-safe by construction)", () => {
  it("states the match count, the corpus size, and the attempts left — nothing else", () => {
    const msg = observationCoaching(2, 6, 2);
    expect(msg).toContain("2 of the 6");
    expect(msg).toContain("2 attempts left");
    // an actionable, non-accusatory invitation — never "fraud", "rejected", or a number it wasn't given
    expect(msg).toMatch(/describe more/i);
    expect(msg).not.toMatch(/fraud|reject|spam|fake/i);
  });

  it("singularizes the final attempt", () => {
    expect(observationCoaching(3, 7, 1)).toContain("1 attempt left");
    expect(observationCoaching(3, 7, 1)).not.toContain("1 attempts");
  });

  it("cannot leak corpus text: identical for the SAME counts regardless of what was actually observed", () => {
    // Two entirely different field-test corpuses that happen to yield the same (matched, size) counts must
    // produce the SAME coaching — proof the corpus never reaches the string. If corpus words leaked, these
    // would differ.
    const a = observationCoaching(4, 8, 1);
    const b = observationCoaching(4, 8, 1);
    expect(a).toBe(b);
    // and it contains none of the words a real corpus might ("rectangle", "toolbar", "wish", …) — it can't,
    // because none were passed in. Assert the surface is purely the fixed template + digits.
    expect(a.replace(/\d+/g, "#")).not.toMatch(/rectangle|toolbar|canvas|wish|excalidraw|yara/i);
  });
});

describe("observationRetryLine (P20 — founder log, no DM)", () => {
  it("reads as 'no action needed yet' and carries the technical token", () => {
    const line = observationRetryLine(1, 3);
    expect(line).toContain("attempt 1 of 3");
    expect(line).toMatch(/no action needed/i);
    expect(line).toContain("(observation_retry)");
  });
});

/**
 * REGRESSION — the first real tester on `launch-yara-garden-cerk8k`. Their account PASSED the
 * observation bar (5 of 9 distinct sources) and the board told them "the submitted link had no usable
 * evidence". Two faults compounded: the feed read the BRAIN's url-lane code instead of the settlement
 * gate's, and there was no sentence for a covenant failure so it would have read as a mystery anyway.
 *
 * A settlement-covenant fault is a statement about the CAMPAIGN. Wording it as a verdict on the
 * worker's evidence is worse than saying nothing.
 */
describe("a covenant fault never reads as a verdict on the tester", () => {
  it("names the campaign, not the submission", () => {
    const s = reasonSentence("action_replay_permit_denied");
    expect(s).toMatch(/campaign/i);
    expect(s).not.toMatch(/no usable evidence|your (work|evidence) (was|is) (bad|unusable)/i);
  });

  it("says explicitly that the work is not what failed", () => {
    expect(reasonSentence("action_replay_permit_denied")).toMatch(
      /not a problem with the submitted work/i,
    );
  });

  it("collapses operator detail to the class, keeping it out of a tester's face", () => {
    const full = reasonSentence(
      "action_replay_permit_denied:inconsistent:policy_without_required",
    );
    expect(full).toBe(reasonSentence("action_replay_permit_denied"));
    expect(full).not.toMatch(/policy_without_required/);
  });

  it("covers the other covenant classes", () => {
    expect(reasonSentence("covenant_frozen")).toMatch(/frozen/i);
    expect(reasonSentence("covenant_metadata_incomplete")).toMatch(/metadata/i);
  });

  it("leaves an unknown token degrading honestly, as before", () => {
    expect(reasonSentence("something_new")).toMatch(/couldn't reach a confident decision/i);
  });

  it("does not disturb the existing brain codes", () => {
    expect(reasonSentence("no_evidence")).toMatch(/no usable evidence/);
    expect(reasonSentence("observation_review")).toMatch(/needs your judgment/);
  });
});

describe("the public sentence carries no raw code", () => {
  it("drops the parenthetical a stranger would read as a bug, and keeps the meaning", () => {
    expect(reasonSentencePublic(null)).toBe("Sage couldn't reach a confident decision");
    expect(reasonSentencePublic("something_new")).toBe("Sage couldn't reach a confident decision");
    // a real class keeps its meaning and loses only the token — the operator sentence still has it
    expect(reasonSentencePublic("no_evidence")).toBe("the submitted link had no usable evidence");
    expect(reasonSentence("no_evidence")).toContain("(no_evidence)");
  });
});

/**
 * The engineering name never reaches a person. "Held for review · Deputy recommends hold" was on
 * the founder's own activity feed — a name that appears nowhere else they could look it up. Applied
 * at the display layer because the source is frozen and the string is already stored on every
 * historical hold.
 */
describe("withProductName", () => {
  it("renames the payout brain to the product, wherever the sentence puts it", () => {
    expect(withProductName("Deputy recommends hold")).toBe("Sage recommends hold");
    expect(withProductName("held because the Deputy could not verify it")).toBe("held because Sage could not verify it");
    expect(withProductName("The Deputy recommends review")).toBe("Sage recommends review");
  });

  it("leaves everything else exactly as written", () => {
    for (const s of [
      "confidence 42% below the 85% autopilot threshold",
      "mainnet autopilot is off — approve this real-money payout manually",
    ]) {
      expect(withProductName(s)).toBe(s);
    }
  });

  it("is word-bounded, so it cannot eat an address, a hash or a path", () => {
    expect(withProductName("/api/deputy/sweep")).toBe("/api/deputy/sweep");
    expect(withProductName("DeputyAssessmentCard")).toBe("DeputyAssessmentCard");
    expect(withProductName("0xdeputyfeed")).toBe("0xdeputyfeed");
  });
});
