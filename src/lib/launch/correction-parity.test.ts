import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { directCampaignCorrection } from "@/lib/mcp/server";

/**
 * THE BATTERY MUST HAND THE MODEL WHAT PRODUCTION HANDS IT.
 *
 * P-DIRECT retries a refused tool call by feeding the model a correction. That text was
 * hand-copied, and the day `splitTotalUsd` landed production told the model one thing while the
 * battery kept telling it the old thing — "every milestone needs rewardUsd", which is now false.
 * A battery giving worse guidance than the product measures a product that does not exist, and
 * would have under-reported the very fix it was there to check.
 *
 * CLAUDE.md already requires this for the prompt and the tools ("a battery must import
 * production's own prompt/tools, never a copy"). The correction is one of them.
 */
describe("P-DIRECT's correction is production's correction", () => {
  it("the battery imports it rather than restating it", () => {
    const src = readFileSync("src/lib/launch/direct-eval.ts", "utf8");
    expect(src).toContain("directCampaignCorrection(");
    // No hand-written variant of the same sentence anywhere in the battery.
    expect(src).not.toMatch(/The campaign isn't valid yet\. Fix ALL/);
  });

  it("names both ways a founder may price the work", () => {
    const t = directCampaignCorrection("x");
    expect(t).toContain("rewardUsd");
    expect(t).toContain("splitTotalUsd");
    expect(t).toMatch(/never a mix/i);
  });

  it("no longer asserts the rule that stopped being true", () => {
    expect(directCampaignCorrection("x")).not.toMatch(/Every milestone needs rewardUsd/);
  });

  it("carries the issues it was given, so a model can act on them", () => {
    expect(directCampaignCorrection("milestones.0.slots: required")).toContain("milestones.0.slots: required");
  });
});
