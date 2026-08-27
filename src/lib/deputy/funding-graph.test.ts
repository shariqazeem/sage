import { describe, expect, it } from "vitest";

import { fundingClusterSignal, __clearFunderCache, __setFunderForTest, firstFunderOf } from "./funding-graph";

/**
 * FUNDING-GRAPH SIBLING DETECTION — pinned against the REAL cluster measured on prod 2026-08-28
 * (campaign launch-www-metis-io-bv31yf): a rejected submitter funded a daisy chain of four fresh
 * wallets, each forwarding the balance minus gas, and the four took every slot of the mission.
 *
 * Two-sided, like every judgment surface here: it must catch the chain AND stay silent on the
 * honest shapes (unrelated wallets, an exchange-funded stranger, an unreadable explorer).
 */

const GOAT = 2345;

// the actual addresses, so this test breaks if the detector stops recognising the real thing
const ROOT = "0xdf70f6e8e656e5bb714ff0e8ca176d76f26890e3"; // rejected, then funded the chain
const A = "0x41c4f9c6d5bd1d970975436a875e94049d0e7699";
const B = "0xe37f26273708a8533c1b3974fb1f48ee74b9d488";
const C = "0xe012f77899058940baacb2e4d139fe0a89b914a8";
const D = "0x91588578e37c2f3a90a8908876a0e4bdfbe9193f";

/** the measured chain: ROOT → A → B → C → D */
const REAL_CHAIN: Record<string, string | null> = { [A]: ROOT, [B]: A, [C]: B, [D]: C, [ROOT]: "0x31f1564d322c493842cb3b228b8e6038d27d8720" };
const chainLookup = async (w: string): Promise<string | null> => REAL_CHAIN[w.toLowerCase()] ?? null;

describe("fundingClusterSignal — the wallet-rotation detector", () => {
  it("catches the REAL daisy chain: each link's gas came from another submitter on the same campaign", async () => {
    const all = [ROOT, A, B, C, D];
    for (const [wallet, parent] of [
      [A, ROOT],
      [B, A],
      [C, B],
      [D, C],
    ] as const) {
      const sig = await fundingClusterSignal(
        { wallet, peerWallets: all.filter((w) => w !== wallet), chainId: GOAT },
        { firstFunder: chainLookup },
      );
      expect(sig, `${wallet} should be flagged`).not.toBeNull();
      expect(sig!.signal).toBe("funded by another submitter");
      expect(sig!.reason).toContain(parent.slice(0, 6));
      // NEVER high — it must never be able to refuse a payout on its own.
      expect(sig!.severity).toBe("med");
    }
  });

  it("catches SIBLINGS funded by one parent who never submitted", async () => {
    const parent = `0x${"7".repeat(40)}`;
    const x = `0x${"1".repeat(40)}`;
    const y = `0x${"2".repeat(40)}`;
    const z = `0x${"3".repeat(40)}`;
    const lookup = async (w: string) => (w.toLowerCase() === z ? null : parent);
    const sig = await fundingClusterSignal({ wallet: x, peerWallets: [y, z], chainId: GOAT }, { firstFunder: lookup });
    expect(sig).not.toBeNull();
    expect(sig!.signal).toBe("sibling-funded wallets");
    expect(sig!.reason).toContain("1 other submitter");
    expect(sig!.severity).toBe("med");
  });

  it("stays SILENT on honest shapes: unrelated funders, a lone submitter, unknown/unreadable funders", async () => {
    const a = `0x${"a".repeat(40)}`;
    const b = `0x${"b".repeat(40)}`;
    const distinct = async (w: string) => `0x${w.slice(2, 4).repeat(20)}`; // every wallet a different parent

    // different funders → nothing
    expect(await fundingClusterSignal({ wallet: a, peerWallets: [b], chainId: GOAT }, { firstFunder: distinct })).toBeNull();
    // no peers at all → nothing (first submitter on a campaign is never suspicious)
    expect(await fundingClusterSignal({ wallet: a, peerWallets: [], chainId: GOAT }, { firstFunder: distinct })).toBeNull();
    // funder unknown (funded off-chain / another chain) → nothing, never a guess
    expect(await fundingClusterSignal({ wallet: a, peerWallets: [b], chainId: GOAT }, { firstFunder: async () => null })).toBeNull();
    // explorer throwing → NO signal (an infra blip must never become an accusation)
    const boom = async () => { throw new Error("explorer down"); };
    expect(await fundingClusterSignal({ wallet: a, peerWallets: [b], chainId: GOAT }, { firstFunder: boom })).toBeNull();
  });

  it("a peer whose lookup fails never invalidates the rest of the scan", async () => {
    const parent = `0x${"9".repeat(40)}`;
    const me = `0x${"1".repeat(40)}`;
    const flaky = `0x${"2".repeat(40)}`;
    const sibling = `0x${"3".repeat(40)}`;
    const lookup = async (w: string) => {
      if (w.toLowerCase() === flaky) throw new Error("timeout");
      return parent;
    };
    const sig = await fundingClusterSignal({ wallet: me, peerWallets: [flaky, sibling], chainId: GOAT }, { firstFunder: lookup });
    expect(sig?.signal).toBe("sibling-funded wallets");
  });

  it("firstFunderOf: an explorer failure returns null and is NOT cached as a permanent unknown", async () => {
    __clearFunderCache();
    const w = `0x${"c".repeat(40)}`;
    // no network in tests → the fetch fails → null, and nothing poisoned in the memo
    expect(await firstFunderOf(w, GOAT)).toBeNull();
    __setFunderForTest(w, GOAT, "0xparent");
    expect(await firstFunderOf(w, GOAT)).toBe("0xparent"); // memo now serves the known value
    __clearFunderCache();
  });
});
