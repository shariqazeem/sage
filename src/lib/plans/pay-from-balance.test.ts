import { describe, expect, it } from "vitest";
import { decideTransferGas, TRANSFER_GAS } from "./pay-from-balance";

/**
 * SAGE PAYS THE NETWORK FEE ON A PLAN PAYMENT FROM THE BALANCE (21 Oct 2026), so paying for Sage needs
 * USDC and nothing else. Exactly one transfer's worth (a quarter of headroom), only when it is missing,
 * and never out of the operator's settlement reserve: payouts to people come first.
 */
const GWEI = BigInt(1_000_000_000);
const price = BigInt(12) * GWEI; // Metis, measured about 12 gwei on 21 Oct 2026
const need = TRANSFER_GAS * price;
const floor = BigInt(200_000_000_000_000_000); // 0.2 METIS

describe("covering the network fee", () => {
  it("covers nothing when the balance already has the fee", () => {
    expect(decideTransferGas({ gasPriceWei: price, gasWei: need, operatorGasWei: BigInt(10) ** BigInt(18), operatorFloorWei: floor })).toEqual({ cover: false, reason: "enough" });
  });

  it("covers the shortfall plus a quarter of headroom, under a cent at Metis prices", () => {
    const d = decideTransferGas({ gasPriceWei: price, gasWei: BigInt(0), operatorGasWei: BigInt(10) ** BigInt(18), operatorFloorWei: floor });
    expect(d).toEqual({ cover: true, amountWei: need + need / BigInt(4) });
    if (d.cover) expect(Number(d.amountWei) / 1e18).toBeLessThan(0.002); // 0.0018 METIS, about $0.007
  });

  it("never dips into the operator's settlement reserve", () => {
    expect(decideTransferGas({ gasPriceWei: price, gasWei: BigInt(0), operatorGasWei: floor, operatorFloorWei: floor })).toEqual({ cover: false, reason: "operator_reserve" });
  });

  it("does not guess when the network's gas price can't be read", () => {
    expect(decideTransferGas({ gasPriceWei: BigInt(0), gasWei: BigInt(0), operatorGasWei: BigInt(10) ** BigInt(18), operatorFloorWei: floor })).toEqual({ cover: false, reason: "unpriced" });
  });
});
