import { describe, expect, it } from "vitest";
import { submissionIntentHash } from "@/lib/db/keys";
import { buildIntentHashMap, settlementLabel } from "./labels";

describe("settlementLabel", () => {
  it("formats campaign title + short wallet", () => {
    expect(
      settlementLabel(
        "Break Sage's onboarding",
        "0x1234567890abcdef1234567890abcdef12345678",
      ),
    ).toBe("Break Sage's onboarding — payout to 0x1234…5678");
  });
});

describe("buildIntentHashMap", () => {
  it("keys each submission by its on-chain intent hash", () => {
    const map = buildIntentHashMap([
      { campaignId: "c1", campaignTitle: "T", submissionId: "s1", wallet: "0xAAA" },
    ]);
    const key = submissionIntentHash("c1", "s1").toLowerCase();
    expect(map[key]).toEqual({ campaignTitle: "T", wallet: "0xAAA" });
  });

  it("distinct submissions get distinct keys", () => {
    const map = buildIntentHashMap([
      { campaignId: "c", campaignTitle: "T", submissionId: "a", wallet: "0x1" },
      { campaignId: "c", campaignTitle: "T", submissionId: "b", wallet: "0x2" },
    ]);
    expect(Object.keys(map)).toHaveLength(2);
  });
});
