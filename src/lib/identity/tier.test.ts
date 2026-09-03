import { describe, expect, it } from "vitest";
import { meetsTier, openTierCeilingBase, requiredTier, tierOf, tierRefusal, type TierEvidence } from "./tier";

const e = (over: Partial<TierEvidence> = {}): TierEvidence => ({
  paidCompletions: 0, distinctCampaigns: 0, distinctPayers: 0, linkedWallets: 0, personhood: null, ...over,
});

describe("standing — who may take the better-paid work", () => {
  it("a wallet with no history is a newcomer, and is told so without being refused outright", () => {
    expect(tierOf(e())).toMatchObject({ tier: "newcomer", reason: "no verified work here yet" });
  });

  it("standing is earned across DIFFERENT campaigns, so one board cannot mint it", () => {
    expect(tierOf(e({ paidCompletions: 9, distinctCampaigns: 1 })).tier).toBe("newcomer");
    expect(tierOf(e({ paidCompletions: 2, distinctCampaigns: 2, distinctPayers: 2 }))).toMatchObject({ tier: "established" });
  });

  it("A LINKED WALLET IS FLAGGED whatever its record — splitting one worker does not multiply standing", () => {
    const v = tierOf(e({ paidCompletions: 20, distinctCampaigns: 9, linkedWallets: 3 }));
    expect(v.tier).toBe("flagged");
    expect(v.reason).toMatch(/linked on-chain to 3 others/);
  });

  it("a verified person is established immediately, but a linked one is still flagged", () => {
    expect(tierOf(e({ personhood: "verified" })).tier).toBe("established");
    expect(tierOf(e({ personhood: "verified", linkedWallets: 1 })).tier).toBe("flagged");
  });

  it("the requirement comes from what the work pays, so no campaign can be left open by accident", () => {
    expect(requiredTier(1_000_000)).toBe("newcomer");
    expect(requiredTier(2_000_000)).toBe("newcomer");
    expect(requiredTier(2_000_001)).toBe("established");
    expect(openTierCeilingBase({ IDENTITY_OPEN_CEILING_USD: "5" })).toBe(5_000_000);
    expect(openTierCeilingBase({})).toBe(2_000_000);
    expect(requiredTier(4_000_000, openTierCeilingBase({ IDENTITY_OPEN_CEILING_USD: "5" }))).toBe("newcomer");
  });

  it("ranks standing so a newcomer passes open work and fails the rest", () => {
    expect(meetsTier("newcomer", "newcomer")).toBe(true);
    expect(meetsTier("newcomer", "established")).toBe(false);
    expect(meetsTier("established", "established")).toBe(true);
    expect(meetsTier("flagged", "newcomer")).toBe(false);
  });

  it("tells a newcomer where to start instead of dead-ending them", () => {
    const t = tierRefusal(tierOf(e({ paidCompletions: 1, distinctCampaigns: 1 })), "established", 5_000_000, 2_000_000);
    expect(t).toContain("$5.00 mission asks for verified standing");
    expect(t).toContain("1 verified payout so far");
    expect(t).toContain("$2.00 or less is open to anyone");
  });
});
