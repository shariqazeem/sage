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
    // A well-formed hash that is simply not Sage's. It still offers somewhere to look.
    const p = await composeStarknetProof(`0x${"ab".repeat(31)}`);
    expect(p.found).toBe(false);
    expect(p.amountUsd).toBeNull();
    expect(p.explorerUrl).toContain("starkscan.co/tx/");
  });

  it("offers NO link for a hash that could not be a transaction", async () => {
    // Linking anyway builds `…/tx/0xdefinitelynot…`, a dead page. REPORTED after the first private
    // collection, where an empty hash produced a bare `…/tx/`.
    const p = await composeStarknetProof("0xdefinitelynotarealpayouthash");
    expect(p.found).toBe(false);
    expect(p.explorerUrl).toBe("");
  });

  it("does not claim an EVM payout as a Starknet one", () => {
    expect(isStarknetPayout("0xnope")).toBe(false);
  });
});
