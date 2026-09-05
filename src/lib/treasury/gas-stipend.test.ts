import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { decideGasStipend, gasRefusalMessage, grantGasStipend } from "./gas-stipend";

/**
 * The operator never pays for a flow that produces no fee — and never twice. A wallet gets the
 * launch floor covered only when its USDC already covers the plan, only once, only while the
 * operator keeps its own reserve, and only for the shortfall (never more than the floor).
 */
const MIN = BigInt(3_000_000_000_000);
const FLOOR = BigInt(5_000_000_000_000);
const base = { walletUsdcBase: BigInt(5_000_000), budgetBase: BigInt(5_000_000), gasWei: BigInt(0), minGasWei: MIN, operatorGasWei: BigInt(16_000_000_000_000), alreadyCovered: false, operatorFloorWei: FLOOR };

describe("decideGasStipend — when the operator covers a launch", () => {
  it("covers the shortfall, with a tenth of headroom, capped at the floor", () => {
    expect(decideGasStipend(base)).toEqual({ grant: true, amountWei: MIN }); // 0 → shortfall = floor → capped at floor
    const half = decideGasStipend({ ...base, gasWei: MIN / BigInt(2) });
    expect(half).toEqual({ grant: true, amountWei: (MIN / BigInt(2)) + MIN / BigInt(20) });
  });
  it("does nothing when the wallet already has gas", () => {
    expect(decideGasStipend({ ...base, gasWei: MIN })).toEqual({ grant: false, reason: "gas_enough" });
  });
  it("refuses a wallet that has not deposited the plan's USDC — gas alone is not a launch", () => {
    expect(decideGasStipend({ ...base, walletUsdcBase: BigInt(4_999_999) })).toEqual({ grant: false, reason: "not_funded" });
    expect(decideGasStipend({ ...base, budgetBase: BigInt(0), walletUsdcBase: BigInt(0) })).toEqual({ grant: false, reason: "not_funded" });
  });
  it("never covers the same wallet twice", () => {
    expect(decideGasStipend({ ...base, alreadyCovered: true })).toEqual({ grant: false, reason: "already_covered" });
  });
  it("keeps the operator's own settlement reserve", () => {
    expect(decideGasStipend({ ...base, operatorGasWei: FLOOR + MIN - BigInt(1) })).toEqual({ grant: false, reason: "operator_reserve" });
    expect(decideGasStipend({ ...base, operatorGasWei: FLOOR + MIN })).toEqual({ grant: true, amountWei: MIN });
  });
});

describe("grantGasStipend — sends once, waits for the receipt, records before returning", () => {
  const wallet = getAddress(`0x${"a".repeat(40)}`);
  const input = { wallet, walletUsdcBase: BigInt(5_000_000), budgetBase: BigInt(5_000_000), gasWei: BigInt(0), minGasWei: MIN };
  it("grants, waits, records", async () => {
    const send = vi.fn(async () => `0x${"11".repeat(32)}` as const);
    const waitReceipt = vi.fn(async () => ({}));
    const record = vi.fn();
    const r = await grantGasStipend(input, { operatorGas: async () => BigInt(16_000_000_000_000), send, waitReceipt, already: () => false, record });
    expect(r).toEqual({ granted: true, amountWei: MIN, txHash: `0x${"11".repeat(32)}` });
    expect(send).toHaveBeenCalledWith(2345, wallet, MIN);
    expect(waitReceipt).toHaveBeenCalledWith(2345, `0x${"11".repeat(32)}`);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ wallet, chainId: 2345, amountWei: MIN, budgetBase: BigInt(5_000_000) }));
  });
  it("refuses before sending when the wallet was covered before, and records nothing", async () => {
    const send = vi.fn();
    const record = vi.fn();
    const r = await grantGasStipend(input, { operatorGas: async () => BigInt(16_000_000_000_000), send, already: () => true, record });
    expect(r).toEqual({ granted: false, reason: "already_covered" });
    expect(send).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
  it("a transfer that does not land is reported, not recorded", async () => {
    const record = vi.fn();
    const r = await grantGasStipend(input, { operatorGas: async () => BigInt(16_000_000_000_000), send: async () => { throw new Error("rpc"); }, already: () => false, record });
    expect(r).toEqual({ granted: false, reason: "send_failed" });
    expect(record).not.toHaveBeenCalled();
  });
  it("every refusal is a sentence with the wallet in it", () => {
    for (const reason of ["gas_enough", "not_funded", "already_covered", "operator_reserve", "send_failed"] as const) {
      expect(gasRefusalMessage(reason, wallet)).toContain(wallet);
    }
  });
});
