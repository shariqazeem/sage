import { describe, expect, it } from "vitest";
import { missionTitleFrom } from "./mission-title";

describe("missionTitleFrom — the founder's sentence becomes a readable card title", () => {
  it("takes the first clause, capitalised, and never cuts mid-word", () => {
    expect(
      missionTitleFrom(
        'Read sagepays.xyz/#privacy, then write a public page (blog, dev.to, gist, Notion) in your own words: how Sage pays people privately on Starknet, and one thing that confused you.',
      ),
    ).toBe("Read sagepays.xyz/#privacy");
    expect(missionTitleFrom("the new logo page is live")).toBe("The new logo page is live");
    expect(missionTitleFrom("she publishes her catalogue as a public page")).toBe("She publishes her catalogue as a public page");
    expect(missionTitleFrom("Write up your private payout — a public page in your own words about trying it")).toBe("Write up your private payout");
    const long = missionTitleFrom("Publish a working setup guide for my product that covers installation configuration and the first successful request end to end");
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith(" ")).toBe(false);
    expect(/\w$/.test(long)).toBe(true); // a whole word at the end, never a fragment
  });

  it("falls back to a numbered milestone for something too short to be a title", () => {
    expect(missionTitleFrom("ok", 2)).toBe("Milestone 3");
    expect(missionTitleFrom("   ")).toBe("Milestone 1");
  });
});
