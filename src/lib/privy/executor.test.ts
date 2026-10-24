import { describe, expect, it } from "vitest";
import { priceTransaction } from "./executor";

/**
 * METIS REFUSES EIP-1559, so a Metis transaction must be signed as type 0 with a gas price.
 *
 * Measured 24 Oct 2026 against andromeda.metis.io: a type-2 transaction answered "rlp: expected
 * input list for types.txdata" before the node read a single field, and the same transaction as
 * type 0 reached "insufficient funds". Every account action on Metis goes through this function.
 */
const base = { to: "0x1111111111111111111111111111111111111111" as const, value: "0x0" as const, data: "0x" as const, nonce: "0x1" as const, gas_limit: "0x5208" as const };
const fees = (gasPrice: bigint, baseFee: bigint | null = null) => ({
  baseFeePerGas: baseFee,
  gasPrice: async () => gasPrice,
  priorityFee: async () => BigInt(2_000_000_000),
});

describe("priceTransaction", () => {
  it("signs Metis Andromeda as a legacy transaction with a bumped gas price", async () => {
    const tx = await priceTransaction(1088, base, fees(BigInt(12_000_000_000)));
    expect(tx.type).toBe(0);
    expect(tx.gas_price).toBe(`0x${BigInt(14_400_000_000).toString(16)}`); // +20%
    expect(tx.max_fee_per_gas).toBeUndefined();
    expect(tx.max_priority_fee_per_gas).toBeUndefined();
  });

  it("keeps GOAT on EIP-1559 with its fixed tip, exactly as every GOAT launch was signed", async () => {
    const tx = await priceTransaction(2345, base, fees(BigInt(10), BigInt(10)));
    expect(tx.type).toBeUndefined();
    expect(tx.gas_price).toBeUndefined();
    expect(tx.max_priority_fee_per_gas).toBe(`0x${BigInt(500_000).toString(16)}`);
    expect(tx.max_fee_per_gas).toBe(`0x${(BigInt(12) + BigInt(500_000)).toString(16)}`);
  });

  it("keeps Arc on EIP-1559 with the tip the chain asks for", async () => {
    const tx = await priceTransaction(5042, base, fees(BigInt(1), BigInt(100)));
    expect(tx.gas_price).toBeUndefined();
    expect(tx.max_priority_fee_per_gas).toBe(`0x${BigInt(2_000_000_000).toString(16)}`);
  });
});
