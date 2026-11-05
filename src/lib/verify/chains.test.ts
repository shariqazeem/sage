import { describe, expect, it } from "vitest";
import { verifyChain, verifiableChainList, VERIFY_ONLY_CHAINS } from "./chains";
import { chainIdKnown } from "@/lib/launch/direct-campaign";
import { verifyOnchainTx } from "./verifiers";
import { LAUNCH_ENABLED_CHAINS } from "@/lib/launch/deployment-service";

/**
 * PAY ON METIS, VERIFY WORK DONE ANYWHERE. A worker's swap on Base or a Safe deployed on Arbitrum is proof
 * Sage can read; none of these chains is ever a place Sage launches or holds money.
 */
describe("verify-only chains", () => {
  it("reads a proof on Sage's own network and on the major EVM chains", () => {
    for (const id of [1088, 1, 8453, 42161, 10, 137, 56, 11155111]) expect(verifyChain(id), String(id)).not.toBeNull();
    expect(verifyChain(900001)).toBeNull(); // Starknet can't be read with an EVM client
    expect(verifyChain(424242)).toBeNull();
  });

  it("a contract naming one of them compiles", () => {
    expect(chainIdKnown(8453)).toBe(true);
    expect(chainIdKnown(424242)).toBe(false);
  });

  it("never becomes a place Sage launches", () => {
    for (const id of Object.keys(VERIFY_ONLY_CHAINS).map(Number)) expect(LAUNCH_ENABLED_CHAINS).not.toContain(id);
  });

  it("the drafter is told Metis first", () => {
    expect(verifiableChainList()[0]?.chainId).toBe(1088);
  });

  it("checks a Base transaction against Base, not Metis", async () => {
    const W = `0x${"1".repeat(40)}`;
    const r = await verifyOnchainTx({ kind: "onchain_tx", chainId: 8453, to: `0x${"2".repeat(40)}` } as never, `0x${"a".repeat(64)}`, W, {
      client: {
        getTransaction: async () => ({ from: W, to: `0x${"2".repeat(40)}`, value: BigInt(0), input: "0x" }),
        getTransactionReceipt: async () => ({ status: "success", logs: [] }),
      },
    });
    expect(r.verified).toBe(true);
    expect(r.publicDetail).toMatch(/Verified on-chain/);
  });
});
