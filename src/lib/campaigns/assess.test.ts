import { describe, expect, it } from "vitest";
import { assessSubmission } from "./assess";

const DOGFOOD = [
  "Completed the /app onboarding — vault created and funded",
  "Evidence link resolves (your vault on the explorer, or your campaign)",
  "A genuine note on friction or what broke",
];

describe("assessSubmission", () => {
  it("recommends paying a solid submission (evidence + real note)", () => {
    const a = assessSubmission({
      criteria: DOGFOOD,
      rewardAmount: 10_000_000,
      evidenceUrl: "https://explorer.metisdevops.link/address/0xabc",
      note: "Created my vault, funded it, and the approve step confused me at first.",
    });
    expect(a.recommendation).toBe("pay");
    expect(a.spamRisk).toBe("low");
    expect(a.evidencePresent).toBe(true);
    expect(a.noteQuality).toBe("substantive");
    // evidence + note criteria should register
    expect(a.criteriaMet).toBeGreaterThanOrEqual(2);
    expect(a.payoutBase).toBe(10_000_000);
  });

  it("holds an empty spam submission (no evidence, no note)", () => {
    const a = assessSubmission({
      criteria: DOGFOOD,
      rewardAmount: 10_000_000,
      evidenceUrl: null,
      note: null,
    });
    expect(a.spamRisk).toBe("high");
    expect(a.recommendation).toBe("hold");
    expect(a.spamReasons).toContain("no evidence link");
    expect(a.spamReasons).toContain("no note");
  });

  it("flags medium risk for evidence but a throwaway note", () => {
    const a = assessSubmission({
      criteria: DOGFOOD,
      rewardAmount: 5_000_000,
      evidenceUrl: "https://github.com/x/y",
      note: "gg",
    });
    expect(a.spamRisk).toBe("medium");
    expect(a.noteQuality).toBe("brief");
  });

  it("matches criteria by token overlap when no evidence/note keyword applies", () => {
    const a = assessSubmission({
      criteria: ["Ship a Korean translation of the docs"],
      rewardAmount: 1_000_000,
      evidenceUrl: "https://github.com/acme/docs/pull/9",
      note: "Added the Korean translation for the docs homepage.",
    });
    expect(a.criteria[0].met).toBe(true);
  });

  it("no criteria → still assessable, recommends pay when clean", () => {
    const a = assessSubmission({
      criteria: [],
      rewardAmount: 2_000_000,
      evidenceUrl: "https://x.com/a/status/1",
      note: "Done, here is the link.",
    });
    expect(a.criteriaTotal).toBe(0);
    expect(a.recommendation).toBe("pay");
  });
});
