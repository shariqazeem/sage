import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WAITING FOR EXECUTION, NOT FOR ACCEPTANCE.
 *
 * `execute` resolves when the sequencer TAKES a transaction, and a reverted one resolves just as
 * happily. MEASURED during the mainnet proof: the claim read back as non-existent immediately
 * after `escrowPayouts` returned, because the deposit had not executed yet. That transaction did
 * in fact succeed — the next one might not, and settlement is about to mark submissions paid on
 * the strength of this return value. `requestVaultPayout` already follows this rule on the vault
 * side; the claims path never learned it.
 */

const execute = vi.fn(async () => ({ transaction_hash: "0xtx" }));
const waitForTransaction = vi.fn(async () => ({ execution_status: "SUCCEEDED" }) as unknown);

vi.mock("starknet", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    Account: class {
      execute = (...a: unknown[]) => execute(...(a as []));
    },
    RpcProvider: class {
      waitForTransaction = (...a: unknown[]) => waitForTransaction(...(a as []));
    },
  };
});
vi.mock("./config", () => ({
  starknetConfig: () => ({
    rpcUrl: "https://rpc.test",
    claimsAddress: "0x6fe4d0",
    tokenAddress: "0x033068",
    accountAddress: "0x46a174",
    privateKey: "0x1",
  }),
  starknetAddresses: () => ({ claims: "0x6fe4d0", token: "0x033068", rpcUrl: "https://rpc.test" }),
}));

import { escrowPayouts } from "./claims";

const leg = { claimCommitment: "123", refundCommitment: "456", amountBase: BigInt(100_000) };
const expiry = Math.floor(Date.now() / 1000) + 86_400;

beforeEach(() => {
  execute.mockClear().mockResolvedValue({ transaction_hash: "0xtx" });
  waitForTransaction.mockClear().mockResolvedValue({ execution_status: "SUCCEEDED" });
});

describe("escrowPayouts confirms the deposit actually executed", () => {
  it("returns the transaction once it has SUCCEEDED", async () => {
    const r = await escrowPayouts([leg], expiry);
    expect(r.transactionHash).toBe("0xtx");
    expect(r.totalBase).toBe(BigInt(100_000));
    expect(r.count).toBe(1);
    expect(waitForTransaction).toHaveBeenCalledWith("0xtx");
  });

  it("THROWS on a reverted deposit rather than reporting an escrow that never happened", async () => {
    waitForTransaction.mockResolvedValue({ execution_status: "REVERTED" });
    await expect(escrowPayouts([leg], expiry)).rejects.toThrow(/reverted/i);
  });

  it("names the transaction in the failure, so a stuck escrow can be traced", async () => {
    waitForTransaction.mockResolvedValue({ execution_status: "REVERTED" });
    await expect(escrowPayouts([leg], expiry)).rejects.toThrow(/0xtx/);
  });

  it("does not return before the receipt is in", async () => {
    let receiptSeen = false;
    waitForTransaction.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 25));
      receiptSeen = true;
      return { execution_status: "SUCCEEDED" };
    });
    await escrowPayouts([leg], expiry);
    expect(receiptSeen).toBe(true);
  });

  it("still escrows when the node reports no execution_status at all", async () => {
    // Some nodes omit it on an accepted transaction; absent is not the same as REVERTED, and
    // refusing there would fail escrows that did happen.
    waitForTransaction.mockResolvedValue({});
    await expect(escrowPayouts([leg], expiry)).resolves.toMatchObject({ transactionHash: "0xtx" });
  });
});
