import { describe, expect, it } from "vitest";
import { maxWithdrawBase, maxWithdrawUsd, USDC_GAS_RESERVE_BASE } from "./withdraw-max";

/** 10 Oct 2026: transfer(5.00) from a 5.00 account reverted on Arc, where USDC is also the gas. */
describe("the most a withdrawal can take", () => {
  it("keeps a cent back on Arc, where the fee is paid in the same USDC", () => {
    expect(maxWithdrawBase(BigInt(5_000_000), 5042)).toBe(BigInt(5_000_000) - USDC_GAS_RESERVE_BASE);
    expect(maxWithdrawUsd(5, 5042)).toBe(4.99);
  });

  it("never rounds up past the balance (4.999365 → 4.98 on Arc, 4.99 on GOAT)", () => {
    expect(maxWithdrawUsd(4.999365, 5042)).toBe(4.98);
    expect(maxWithdrawUsd(4.999365, 2345)).toBe(4.99);
  });

  it("takes the whole balance where the gas is another token (GOAT pays gas in BTC)", () => {
    expect(maxWithdrawBase(BigInt(5_000_000), 2345)).toBe(BigInt(5_000_000));
    expect(maxWithdrawUsd(5, 2345)).toBe(5);
  });

  it("is zero, not negative, for dust", () => {
    expect(maxWithdrawBase(BigInt(5_000), 5042)).toBe(BigInt(0));
    expect(maxWithdrawUsd(0.004, 5042)).toBe(0);
  });
});
