import { describe, expect, it } from "vitest";
import { reasonSentence, heldLine, decisionLabel } from "./reason-copy";

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
