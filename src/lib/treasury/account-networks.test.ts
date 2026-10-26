import { describe, expect, it } from "vitest";
import { accountNetworks, moreNetworks } from "./account-networks";

/**
 * WHICH NETWORKS AN ACCOUNT PAGE SHOWS (26 Oct 2026: one network, Metis). Metis always; GOAT only where the
 * founder holds an account there (paused, so its money stays reachable); Arc and Starknet never, even when
 * held, asked for or fully configured; testnets never. Nothing is left to open under "More networks".
 */
describe("the networks an account page shows", () => {
  it("shows Metis, the home network, and nothing else for a new founder", () => {
    const r = accountNetworks({ home: 1088, configured: [1088, 2345, 5042], held: [] });
    expect(r.primary).toEqual([1088]);
    expect(r.secondary).toEqual([]);
    expect(r.selected).toBe(1088);
  });

  it("keeps a held GOAT account reachable (paused), and selects it when asked", () => {
    expect(accountNetworks({ home: 1088, configured: [1088, 2345], held: [1088, 2345] }).secondary).toEqual([2345]);
    const asked = accountNetworks({ home: 1088, configured: [1088, 2345], held: [2345], asked: 2345 });
    expect(asked.secondary).toEqual([2345]);
    expect(asked.selected).toBe(2345);
  });

  it("never shows Arc or Starknet: closed, even when held, asked for or configured", () => {
    const r = accountNetworks({ home: 1088, configured: [1088, 2345, 5042, 900001], held: [5042, 900001], asked: 5042 });
    expect([...r.primary, ...r.secondary]).not.toContain(5042);
    expect([...r.primary, ...r.secondary]).not.toContain(900001);
    expect(r.selected).toBe(1088);
  });

  it("never shows a retired testnet, even if held or asked for", () => {
    const r = accountNetworks({ home: 1088, configured: [1088, 2345, 5042002], held: [5042002], asked: 5042002 });
    expect([...r.primary, ...r.secondary]).not.toContain(5042002);
    expect(r.selected).toBe(1088);
  });

  it("offers nothing more to open: GOAT is paused, Arc and Starknet are closed", () => {
    expect(moreNetworks({ configured: [1088, 2345, 5042], shown: [1088] })).toEqual([]);
    expect(moreNetworks({ configured: [1088, 2345, 5042], shown: [1088, 2345] })).toEqual([]);
  });
});
