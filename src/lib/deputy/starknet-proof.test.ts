import { describe, expect, it, vi } from "vitest";

vi.mock("starknet", () => ({
  RpcProvider: class {
    getTransactionReceipt() {
      return Promise.resolve({ execution_status: "SUCCEEDED", block_number: 14_030_119 });
    }
  },
}));

import { composeStarknetProof, isStarknetPayout } from "./starknet-proof";

describe("the Starknet receipt", () => {
  /**
   * An unknown hash must read as not-found rather than throw. A receipt page that errors on a
   * mistyped hash is worse than one that says it does not recognise it.
   */
  it("reads an unknown transaction as not found, without throwing", async () => {
    const p = await composeStarknetProof("0xdefinitelynotarealpayouthash");
    expect(p.found).toBe(false);
    expect(p.amountUsd).toBeNull();
    // Even so, it still offers somewhere to look — the hash may be real and simply not Sage's.
    expect(p.explorerUrl).toContain("voyager.online/tx/");
  });

  it("does not claim an EVM payout as a Starknet one", () => {
    expect(isStarknetPayout("0xnope")).toBe(false);
  });
});
