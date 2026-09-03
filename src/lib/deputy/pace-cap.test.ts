import { afterEach, describe, expect, it } from "vitest";
import { autopayHourlyCap, DEFAULT_AUTOPAY_HOURLY_CAP, paceCapHold } from "./pace-cap";


describe("autopay pace cap", () => {
  afterEach(() => { delete process.env.AUTOPAY_HOURLY_CAP; });
  it("holds the next payout once the cap is reached within the hour, and says so", () => {
    const r = paceCapHold(4, 4);
    expect(r).toMatch(/4 payouts in the last hour.*cap 4.*releases it by itself/);
  });
  it("below the cap nothing holds", () => {
    expect(paceCapHold(0, 4)).toBeNull();
    expect(paceCapHold(3, 4)).toBeNull();
  });
  it("cap 0 disables it; the env sets it; garbage falls back to the default", () => {
    expect(paceCapHold(2, 0)).toBeNull();
    process.env.AUTOPAY_HOURLY_CAP = "10";
    expect(autopayHourlyCap()).toBe(10);
    process.env.AUTOPAY_HOURLY_CAP = "many";
    expect(autopayHourlyCap()).toBe(DEFAULT_AUTOPAY_HOURLY_CAP);
  });
});
