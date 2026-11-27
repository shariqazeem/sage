import { describe, expect, it } from "vitest";
import { createInspectionJob } from "./inspection";

/** Where a builder came from is kept on the test they started: a clean tag, or the door's own word. */
let n = 0;
const start = (over: { via?: string | null; founder?: string; surface?: string }) =>
  createInspectionJob({
    founderWallet: over.founder ?? `0x${"5".repeat(40)}`,
    publicCampaignId: `launch-via-${++n}`,
    productUrl: `https://via${n}.example`,
    goal: "",
    targetUsers: "",
    totalBudgetBase: BigInt(20_000_000),
    tokenDecimals: 6,
    planningRequestId: `req-via-${n}`,
    surface: over.surface ?? "web",
    via: over.via,
  }).job;

describe("via on an inspection", () => {
  it("keeps a clean tag, lower-cased", () => {
    expect(start({ via: "tiktok" }).via).toBe("tiktok");
    expect(start({ via: " DM-Nov " }).via).toBe("dm-nov");
  });

  it("keeps nothing for a paste with no tag or one that is not a short word", () => {
    expect(start({}).via).toBeNull();
    expect(start({ via: "me@example.com" }).via).toBeNull();
    expect(start({ via: "a".repeat(40) }).via).toBeNull();
  });

  it("a tag on X and a start from the Telegram chat say so themselves", () => {
    expect(start({ founder: "x:12345" }).via).toBe("x");
    expect(start({ founder: "clawup:777", surface: "telegram" }).via).toBe("telegram");
    // a tag the browser carried still wins on the web
    expect(start({ via: "tiktok", surface: "web" }).via).toBe("tiktok");
  });

  it("does not change what was asked: the same request with another tag is the same test", () => {
    const first = createInspectionJob({ founderWallet: `0x${"6".repeat(40)}`, publicCampaignId: "launch-via-same", productUrl: "https://same.example", goal: "", targetUsers: "", totalBudgetBase: BigInt(1), tokenDecimals: 6, planningRequestId: "req-via-same", surface: "web", via: "tiktok" });
    const again = createInspectionJob({ founderWallet: `0x${"6".repeat(40)}`, publicCampaignId: "launch-via-same", productUrl: "https://same.example", goal: "", targetUsers: "", totalBudgetBase: BigInt(1), tokenDecimals: 6, planningRequestId: "req-via-same", surface: "web", via: "dm" });
    expect(again.created).toBe(false);
    expect(again.job.id).toBe(first.job.id);
    expect(again.job.via).toBe("tiktok");
  });
});
