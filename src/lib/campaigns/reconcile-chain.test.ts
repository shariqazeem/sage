import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A BLOCK HEIGHT ONLY MEANS SOMETHING ON THE CHAIN IT WAS READ FROM.
 *
 * The journal cursor was keyed by vault address alone, and the one caller passed no chainId — so
 * every vault reconciled against `activeNetwork()`, which resolves to Metis and never to GOAT.
 * Two live policy_v1 campaigns on GOAT had their vendor events read from a chain their vault does
 * not exist on, found nothing, and stored a METIS block height under the GOAT vault's key.
 *
 * That is not a failure that retries. Metis is far ahead of that vault's own chain, so
 * `reconcileRange` answers `from > latest` -> null from then on: the reconciler quietly never runs
 * for those campaigns again.
 */

const h = vi.hoisted(() => ({
  cursors: new Map<string, number>(),
  heights: new Map<number, number>(),
  logCalls: [] as { chainId: number; fromBlock: bigint }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/deputy/chain", () => ({
  policyVaultAbi: [],
  publicClient: (chainId?: number) => {
    const id = chainId ?? 59902; // what activeNetwork() resolves to — never GOAT
    return {
      chain: { id },
      getBlockNumber: async () => BigInt(h.heights.get(id) ?? 0),
      getContractEvents: async ({ fromBlock }: { fromBlock: bigint }) => {
        h.logCalls.push({ chainId: id, fromBlock });
        return [];
      },
    };
  },
}));
vi.mock("@/lib/db/campaigns", () => ({
  getVaultCursor: (k: string) => h.cursors.get(k.toLowerCase()) ?? 0,
  setVaultCursor: (k: string, b: number) => void h.cursors.set(k.toLowerCase(), b),
  getCampaignsByVault: () => [],
  listSubmissions: () => [],
  recordChainEvent: () => {},
}));

import { reconcileVendorEvents } from "./reconcile";

const VAULT = "0x52a7ae4e78120a3d3f0dE1C0Ab0dCcAB0dCcAb0D";
const GOAT = 2345;
const METIS = 59902;

beforeEach(() => {
  h.cursors.clear();
  h.heights.clear();
  h.logCalls.length = 0;
});

describe("the journal cursor is per chain", () => {
  it("keys the cursor by the chain it actually read", async () => {
    h.heights.set(GOAT, 5_000);
    await reconcileVendorEvents(VAULT, GOAT);
    expect([...h.cursors.keys()]).toEqual([`${GOAT}:${VAULT.toLowerCase()}`]);
    expect(h.cursors.get(`${GOAT}:${VAULT.toLowerCase()}`)).toBe(5_000);
  });

  it("does not let one chain's height silence another's — the measured failure", async () => {
    // Metis is millions of blocks ahead of this vault's own chain.
    h.heights.set(METIS, 1_950_000);
    h.heights.set(GOAT, 5_000);

    await reconcileVendorEvents(VAULT); // the old call shape: no chainId, so Metis
    // Capped at RECONCILE_RANGE, which is still an order of magnitude past GOAT's head — under the
    // old shared key that alone was enough to answer `from > latest` for the GOAT vault forever.
    expect(h.cursors.get(`${METIS}:${VAULT.toLowerCase()}`)).toBe(50_000);

    // The GOAT reconcile must still start from scratch and actually scan.
    h.logCalls.length = 0;
    const result = await reconcileVendorEvents(VAULT, GOAT);
    expect(result).not.toBeNull();
    expect(h.logCalls.map((c) => c.chainId)).toEqual([GOAT, GOAT]);
    expect(h.logCalls[0].fromBlock).toBe(BigInt(1));
  });

  it("still reports nothing to do once a chain is caught up", async () => {
    h.heights.set(GOAT, 5_000);
    await reconcileVendorEvents(VAULT, GOAT);
    h.logCalls.length = 0;
    expect(await reconcileVendorEvents(VAULT, GOAT)).toBeNull();
    expect(h.logCalls).toHaveLength(0);
  });

  it("reads the chain it was asked for, not the default", async () => {
    h.heights.set(GOAT, 5_000);
    h.heights.set(METIS, 900_000);
    await reconcileVendorEvents(VAULT, GOAT);
    expect(h.logCalls.every((c) => c.chainId === GOAT)).toBe(true);
  });
});
