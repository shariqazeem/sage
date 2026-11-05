import { describe, expect, it } from "vitest";
import { withListedTxs } from "./verifiers";
import type { ArtifactUrlContract } from "./contract";

/**
 * A doc that lists transactions, each read on its chain (ArtifactUrlContract.txProof). Sage Bench r5: a pilot
 * of 20 payments, four testnet transactions and a bridge were all "proved" by hashes typed into a doc that
 * nothing checked, so a fake, reverted or someone else's hash would have paid.
 */
const W = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const ROUTER = "0x3333333333333333333333333333333333333333";
const START = 1_793_800_000;
const h = (n: number) => `0x${n.toString(16).padStart(64, "a")}`;
type Tx = { from: string; to: string; status: "success" | "reverted"; at: number; flaky?: boolean };

function chain(txs: Record<string, Tx>) {
  const get = (hash: string) => {
    const t = txs[hash.toLowerCase()];
    if (!t) throw Object.assign(new Error(`Transaction with hash "${hash}" could not be found.`), { name: "TransactionNotFoundError" });
    if (t.flaky) throw new Error("fetch failed");
    return t;
  };
  return {
    getTransaction: async ({ hash }: { hash: string }) => {
      const t = get(hash);
      return { from: t.from, to: t.to, value: BigInt(0), input: "0x" };
    },
    getTransactionReceipt: async ({ hash }: { hash: string }) => {
      const t = get(hash);
      return { status: t.status, logs: [], contractAddress: null, blockNumber: BigInt(t.at) };
    },
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: BigInt(blockNumber) }),
  };
}

const passed = { verified: true, strength: "strong" as const, detail: "artifact live + tester-marked", publicDetail: "Verified: the object you created is live and carries your marker." };
const contract = (minTxs: number, to?: string[]): ArtifactUrlContract => ({ kind: "artifact_url", allowedHosts: [], markerKind: "wallet", txProof: { chainId: 84532, minTxs, ...(to ? { to } : {}) } });
const doc = (...hashes: string[]) => `My bug bash report. Wallet ${W}.\n${hashes.map((x, i) => `${i + 1}. swap: ${x}`).join("\n")}`;

describe("transactions listed in the work, each checked on chain", () => {
  it("pays when enough listed transactions are the worker's own, succeeded and came after the job", async () => {
    const c = chain({ [h(1)]: { from: W, to: ROUTER, status: "success", at: START + 100 }, [h(2)]: { from: W, to: ROUTER, status: "success", at: START + 200 }, [h(3)]: { from: W, to: ROUTER, status: "success", at: START + 300 } });
    const r = await withListedTxs(passed, doc(h(1), h(2), h(3)), contract(3), W, { notBefore: START, txClient: c });
    expect(r.verified).toBe(true);
    expect(r.publicDetail).toMatch(/checked the listed transactions \(3 on Base Sepolia \(testnet\)\)/);
  });

  it("someone else's, a reverted one, an old one and a made-up hash don't count", async () => {
    const c = chain({
      [h(1)]: { from: W, to: ROUTER, status: "success", at: START + 100 },
      [h(2)]: { from: OTHER, to: ROUTER, status: "success", at: START + 200 },
      [h(3)]: { from: W, to: ROUTER, status: "reverted", at: START + 300 },
      [h(4)]: { from: W, to: ROUTER, status: "success", at: START - 86_400 },
    });
    const r = await withListedTxs(passed, doc(h(1), h(2), h(3), h(4), h(5)), contract(2), W, { notBefore: START, txClient: c });
    expect(r.verified).toBe(false);
    expect(r.detail).toBe("listed tx short: 1 of the 2 asked for on Base Sepolia (testnet)");
    expect(r.publicDetail).toMatch(/1 of the 2 asked for on Base Sepolia/);
  });

  it("a read that didn't complete holds, and is never counted against the worker", async () => {
    const c = chain({ [h(1)]: { from: W, to: ROUTER, status: "success", at: START + 100 }, [h(2)]: { from: W, to: ROUTER, status: "success", at: START + 200, flaky: true } });
    const r = await withListedTxs(passed, doc(h(1), h(2)), contract(2), W, { notBefore: START, txClient: c });
    expect(r.verified).toBe(false);
    expect(r.detail).toBe("fetch hold");
  });

  it("when the job names the contract, only transactions to it count", async () => {
    const c = chain({ [h(1)]: { from: W, to: ROUTER, status: "success", at: START + 100 }, [h(2)]: { from: W, to: OTHER, status: "success", at: START + 200 } });
    expect((await withListedTxs(passed, doc(h(1), h(2)), contract(2, [ROUTER]), W, { notBefore: START, txClient: c })).verified).toBe(false);
    expect((await withListedTxs(passed, doc(h(1), h(2)), contract(1, [ROUTER]), W, { notBefore: START, txClient: c })).verified).toBe(true);
  });

  it("a bridge lists one transaction on each side, and each side is checked on its own network", async () => {
    const arbitrum = chain({ [h(1)]: { from: W, to: ROUTER, status: "success", at: START + 100 } });
    const metis = chain({ [h(2)]: { from: W, to: OTHER, status: "success", at: START + 400 } });
    const c: ArtifactUrlContract = { kind: "artifact_url", allowedHosts: [], markerKind: "wallet", txProof: [{ chainId: 42161, minTxs: 1 }, { chainId: 1088, minTxs: 1 }] };
    const byChain = (id: number) => (id === 42161 ? arbitrum : metis);
    const r = await withListedTxs(passed, doc(h(1), h(2)), c, W, { notBefore: START, txClient: byChain });
    expect(r.verified).toBe(true);
    expect(r.publicDetail).toMatch(/1 on Arbitrum One, 1 on Metis/);
    // only the Arbitrum side listed: the Metis side is short, and the worker is told which
    const half = await withListedTxs(passed, doc(h(1)), c, W, { notBefore: START, txClient: byChain });
    expect(half.verified).toBe(false);
    expect(half.publicDetail).toMatch(/0 of the 1 asked for on Metis/);
  });

  it("work that already failed is not read on chain at all", async () => {
    const failed = { ...passed, verified: false, detail: "marker absent" };
    expect(await withListedTxs(failed, doc(h(1)), contract(1), W, { notBefore: START, txClient: chain({}) })).toBe(failed);
  });
});
