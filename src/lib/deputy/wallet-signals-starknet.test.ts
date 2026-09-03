import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/campaigns/wallet-links", () => ({ linkedWalletsOf: () => [] }));
import { peerFunders, starknetClusterSignals, starknetFreshnessSignal } from "./wallet-signals-starknet";
import { padFelt, TRANSFER_SELECTOR, type Rpc } from "@/lib/starknet/transfers";

const ME = "0x0499b03b05e4409e1a48de30aac576381d6f650ad6c36fec664301bec8da11d5";
const HUB = "0x0270f1135c91912cd47d8d434aaf8698d4a5fc32a525c3033b90aaa284a0b8de";
const OTHER = "0x0604dbbda5cdefb597b82894a4aae05ca85a66503d6ae6056de0d12cbe1c53b1";

const rpcWith = (opts: { nonce?: string; strkFrom?: string[] }): Rpc => async (method, params) => {
  if (method === "starknet_blockNumber") return 14_277_000;
  if (method === "starknet_getNonce") return opts.nonce ?? "0x0";
  if (method === "starknet_getEvents") {
    const p = (params as [{ address: string }])[0];
    if (p.address.startsWith("0x04718")) return { events: (opts.strkFrom ?? []).map((f) => ({ keys: [TRANSFER_SELECTOR, f, padFelt(ME)], data: ["0x1bc16d674ec80000", "0x0"], block_number: 14_276_000, transaction_hash: "0x1" })) };
    return { events: [] };
  }
  throw new Error(`unexpected ${method}`);
};

describe("Starknet wallet signals", () => {
  it("a wallet that never sent a transaction is a medium 'fresh wallet'; a young one is low; an old one is silent", async () => {
    expect((await starknetFreshnessSignal(ME, { rpc: rpcWith({ nonce: "0x0" }) }))?.severity).toBe("med");
    expect((await starknetFreshnessSignal(ME, { rpc: rpcWith({ nonce: "0x2" }) }))?.severity).toBe("low");
    expect(await starknetFreshnessSignal(ME, { rpc: rpcWith({ nonce: "0x9" }) })).toBeNull();
    expect(await starknetFreshnessSignal(ME, { rpc: null })).toBeNull();
  });

  it("gas from another submitter of the campaign is the medium funding signal (tonight: 0x0499 ← 0x0270)", async () => {
    const s = await starknetClusterSignals({ wallet: ME, peerWallets: [HUB, OTHER, ME] }, { rpc: rpcWith({ strkFrom: [padFelt(HUB)] }), linked: () => [] });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ signal: "funded by another submitter", severity: "med" });
    expect(s[0].reason).toMatch(/0x0270…b8de/);
  });

  it("a payout-consolidation link to another submitter is HIGH, with or without RPC", async () => {
    const s = await starknetClusterSignals({ wallet: ME, peerWallets: [HUB] }, { rpc: null, linked: () => [padFelt(HUB), padFelt("0x0999")] });
    expect(s[0]).toMatchObject({ signal: "wallet cluster", severity: "high" });
    expect(s[0].reason).toMatch(/linked on-chain to 1 other submitter/);
  });

  it("gas from a stranger, or no peers, is no signal; an RPC blip is no signal", async () => {
    expect(await starknetClusterSignals({ wallet: ME, peerWallets: [OTHER] }, { rpc: rpcWith({ strkFrom: [padFelt("0x0321")] }), linked: () => [] })).toHaveLength(0);
    expect(await starknetClusterSignals({ wallet: ME, peerWallets: [] }, { rpc: rpcWith({}), linked: () => [padFelt(HUB)] })).toHaveLength(0);
    const boom: Rpc = async () => { throw new Error("down"); };
    expect(await starknetClusterSignals({ wallet: ME, peerWallets: [HUB] }, { rpc: boom, linked: () => [] })).toHaveLength(0);
    expect(peerFunders([], [HUB])).toEqual([]);
  });
});
