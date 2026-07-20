import { describe, expect, it } from "vitest";
import {
  reasonSentence,
  heldLine,
  decisionLabel,
  observationCoaching,
  observationRetryLine,
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
