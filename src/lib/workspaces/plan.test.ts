import { afterEach, describe, expect, it } from "vitest";
import { canAddMember, DEFAULT_PRO_PRICE_USD, FREE_MEMBER_CAP, planOf, proPriceUsd } from "./plan";

const now = 1_800_000_000;

describe("workspace plans", () => {
  afterEach(() => { delete process.env.SAGE_PRO_PRICE_USD; });
  it("free allows an owner and two more; the fourth needs Pro", () => {
    const free = { plan: "free" as const, planUntil: null };
    expect(canAddMember(free, 2, now)).toBe(true);
    expect(canAddMember(free, FREE_MEMBER_CAP, now)).toBe(false);
  });
  it("a lapsed Pro is Free again — no error, no lockout", () => {
    expect(planOf({ plan: "pro", planUntil: now + 10 }, now)).toBe("pro");
    expect(planOf({ plan: "pro", planUntil: now - 10 }, now)).toBe("free");
    expect(planOf({ plan: "pro", planUntil: null }, now)).toBe("free");
    expect(canAddMember({ plan: "pro", planUntil: now + 10 }, 500, now)).toBe(true);
  });
  it("the price comes from the env, with a sane default", () => {
    expect(proPriceUsd()).toBe(DEFAULT_PRO_PRICE_USD);
    process.env.SAGE_PRO_PRICE_USD = "49";
    expect(proPriceUsd()).toBe(49);
    process.env.SAGE_PRO_PRICE_USD = "free";
    expect(proPriceUsd()).toBe(DEFAULT_PRO_PRICE_USD);
  });
});
