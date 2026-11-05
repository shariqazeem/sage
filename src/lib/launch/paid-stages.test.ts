import { describe, expect, it } from "vitest";
import { paidStageCount } from "./stated-terms";

/**
 * A BRIEF THAT PRICES ITS STAGES ONE BY ONE (6 Nov 2026). Sage Bench r11 drafted three such briefs as ONE
 * milestone paying the whole budget for the first stage, because no sentence said "three stages".
 */
describe("stages priced one by one", () => {
  it("counts stages the pay follows, by name or as a priced numbered list", () => {
    expect(paidStageCount("$1,800 total: $1,200 when Stage 1 is accepted, $600 when Stage 2 is accepted.")).toBe(2);
    expect(paidStageCount("Budget is $900 total, $300 per stage.\nStage 1: Jan-Feb\nStage 2: Mar-Apr\nStage 3: May-Jun")).toBe(3);
    expect(paidStageCount("Stages and payment (paid per stage on acceptance)\n1. Methodology note. $400.\n2. Sheet model. $700.\n3. Final memo. 700 USD.")).toBe(3);
  });

  it("never counts steps, or prices that don't follow stages", () => {
    expect(paidStageCount("1. Fork the repo.\n2. Fix the bug.\n3. Open a PR. $350 when it's merged.")).toBeNull();
    expect(paidStageCount("Steps:\n1. Buy the $20 kit\n2. Assemble it, about $5 of glue\nPay: $80 for the video.")).toBeNull();
    expect(paidStageCount("Stage 1 is research and Stage 2 is writing, $500 for the whole thing.")).toBeNull();
    expect(paidStageCount("$300 per stage, Stage 1 only for now")).toBeNull();
  });
});
