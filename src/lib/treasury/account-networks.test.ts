import { describe, expect, it } from "vitest";
import { accountNetworks, moreNetworks } from "./account-networks";

/** Primary always (once configured), secondary only when held or asked for, testnets never. */
describe("the networks an account page shows", () => {
  it("shows GOAT and Metis once configured, home first", () => {
    const r = accountNetworks({ home: 2345, configured: [2345, 1088, 5042], held: [] });
    expect(r.primary).toEqual([2345, 1088]);
    expect(r.secondary).toEqual([]);
    expect(r.selected).toBe(2345);
  });

  it("hides Metis until its factory is configured (no dead door)", () => {
    expect(accountNetworks({ home: 2345, configured: [2345, 5042], held: [] }).primary).toEqual([2345]);
  });

  it("keeps a held secondary account reachable, and opens one when asked", () => {
    expect(accountNetworks({ home: 2345, configured: [2345, 1088, 5042], held: [5042] }).secondary).toEqual([5042]);
    const asked = accountNetworks({ home: 2345, configured: [2345, 1088, 5042], held: [], asked: 5042 });
    expect(asked.secondary).toEqual([5042]);
    expect(asked.selected).toBe(5042);
  });

  it("never shows a retired testnet, even if held or asked for", () => {
    const r = accountNetworks({ home: 2345, configured: [2345, 1088, 5042, 5042002], held: [5042002], asked: 5042002 });
    expect([...r.primary, ...r.secondary]).not.toContain(5042002);
    expect(r.selected).toBe(2345);
  });

  it("offers the configured secondary networks not yet shown under More networks", () => {
    expect(moreNetworks({ configured: [2345, 1088, 5042], shown: [2345, 1088] })).toEqual([5042]);
    expect(moreNetworks({ configured: [2345, 1088, 5042], shown: [2345, 1088, 5042] })).toEqual([]);
  });
});
