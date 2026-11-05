import { describe, expect, it } from "vitest";
import { verifyOnchainTx, TX_RECENCY_SLACK_SECONDS } from "./verifiers";
import type { OnchainTxContract } from "./contract";

/**
 * A TRANSACTION FROM BEFORE THE JOB EXISTED WAS NOT DONE FOR IT.
 *
 * On-chain proofs had no recency bound (found 5 Nov 2026): an old swap, an old deployment, or months of
 * someone's history satisfied a job posted today.
 */
const WORKER = `0x${"1".repeat(40)}`;
const TARGET = `0x${"2".repeat(40)}`;
const HASH = `0x${"a".repeat(64)}`;
const contract = { kind: "onchain_tx", chainId: 1088, to: TARGET } as unknown as OnchainTxContract;
const POSTED = 1_793_800_000;

const client = (blockTime: number | null) => ({
  getTransaction: async () => ({ from: WORKER, to: TARGET, value: BigInt(0), input: "0x" }),
  getTransactionReceipt: async () => ({ status: "success", logs: [], contractAddress: null, blockNumber: BigInt(123) }),
  getBlock: async () => ({ timestamp: blockTime === null ? undefined : BigInt(blockTime) }),
});

describe("on-chain proof recency", () => {
  it("pays a transaction made after the job was posted", async () => {
    const r = await verifyOnchainTx(contract, HASH, WORKER, { client: client(POSTED + 3600), notBefore: POSTED });
    expect(r.verified).toBe(true);
  });

  it("refuses one made before it, definitively and in words the worker can act on", async () => {
    const r = await verifyOnchainTx(contract, HASH, WORKER, { client: client(POSTED - 86_400), notBefore: POSTED });
    expect(r.verified).toBe(false);
    expect(r.detail).toBe("tx predates the job");
    expect(r.publicDetail).toMatch(/before this job was posted/);
  });

  it("allows for clock skew between the chain and the server", async () => {
    const r = await verifyOnchainTx(contract, HASH, WORKER, { client: client(POSTED - TX_RECENCY_SLACK_SECONDS + 5), notBefore: POSTED });
    expect(r.verified).toBe(true);
  });

  it("holds (retries later) rather than passing when the block's time can't be read", async () => {
    const r = await verifyOnchainTx(contract, HASH, WORKER, { client: client(null), notBefore: POSTED });
    expect(r.verified).toBe(false);
    expect(r.detail).toBe("rpc/parse hold");
  });
});
