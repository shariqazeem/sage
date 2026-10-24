import { describe, expect, it } from "vitest";
import { treasuryPreflight } from "./preflight";

const A = "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6";
const base = { budgetBase: BigInt(5_000_000), capBase: BigInt(10_000_000), balanceBase: BigInt(6_000_000), gasWei: BigInt(4_000_000_000_000), minGasWei: BigInt(3_000_000_000_000), address: A };

describe("treasury preflight — the sentences before the agent spends", () => {
  it("passes when the cap, the balance and the gas all cover the campaign", () => {
    expect(treasuryPreflight(base)).toEqual({ ok: true });
  });
  it("names the cap, the shortfall, or the gas — in that order", () => {
    expect(treasuryPreflight({ ...base, capBase: BigInt(4_000_000) })).toMatchObject({ ok: false, reason: "overCap" });
    expect(treasuryPreflight({ ...base, balanceBase: BigInt(1_000_000) })).toMatchObject({ ok: false, reason: "needsFunding", message: expect.stringContaining("$1.00 USDC") });
    expect(treasuryPreflight({ ...base, gasWei: BigInt(0) })).toMatchObject({ ok: false, reason: "needsGas" });
  });
  it("on Metis, the gas sentence names the chain's own launch floor and how to get METIS", () => {
    const r = treasuryPreflight({ ...base, chainId: 1088, gasWei: BigInt(0), minGasWei: BigInt("50000000000000000") });
    expect(r).toMatchObject({ ok: false, reason: "needsGas" });
    const msg = (r as { message: string }).message;
    expect(msg).toContain("0.05 METIS");
    expect(msg).toContain("Binance");
    expect(msg).not.toContain("0.00001");
    // with no METIS at all, a swap cannot pay for itself, so it is not offered
    expect(msg).not.toContain("Swap a little USDC");
  });
  it("offers the in-account swap only when the account can pay for one", () => {
    const r = treasuryPreflight({ ...base, chainId: 1088, gasWei: BigInt("10000000000000000"), minGasWei: BigInt("50000000000000000"), gasPriceWei: BigInt(12_000_000_000) });
    expect((r as { message: string }).message).toContain("Swap a little USDC to METIS");
  });
});
