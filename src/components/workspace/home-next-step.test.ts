import { describe, expect, it } from "vitest";
import { nextStep, type OwnerView } from "./owner-workspace";

/**
 * HOME ASKS FOR ONE THING. The first true step wins, so a new founder is never handed three doors at
 * once, and a founder with nothing left to do is asked for nothing.
 */
const base: OwnerView = {
  workspace: { id: "ws", name: "Acme", slug: "acme", plan: "free", planUntil: null, memberCap: 3, proPriceUsd: 29 },
  members: [],
  memberCount: 1,
  campaigns: [],
  desk: { events: [], lastWorkedAt: null },
  me: "m",
};
const open = (usdc: number, gasWei: string) => ({ state: "open" as const, network: "Metis", nativeSymbol: "METIS", usdc, gasWei, gasUsd: null, launchFloorWei: "50000000000000000", usdcIsGas: false, canSwap: true });
const job = (pending = 0) => ({ id: "c", title: "t", kind: "gig" as const, status: "live", visibility: "listed" as const, rail: "evm" as const, chainId: 1088, rewardBase: 1_000_000, paid: 0, pending, slots: 5, paidBase: 0 });

describe("Home's one next step", () => {
  it("opens the account first", () => {
    expect(nextStep({ ...base, account: { state: "none", network: "Metis" } })?.key).toBe("open");
  });
  it("then asks for money, then for the fee token, then for the first job", () => {
    expect(nextStep({ ...base, account: open(0, "0") })?.key).toBe("add");
    const fee = nextStep({ ...base, account: open(25, "0") });
    expect(fee?.key).toBe("fee");
    expect(fee?.cta).toBe("Add METIS"); // nothing to pay a swap with yet
    expect(nextStep({ ...base, account: open(25, "10000000000000000") })?.cta).toBe("Swap");
    expect(nextStep({ ...base, account: open(25, "60000000000000000") })?.key).toBe("post");
  });
  it("while Metis is opening, it still points at the first job's plan, never at a dead door", () => {
    expect(nextStep({ ...base, account: { state: "closed", network: "Metis", reason: "Sage is opening on Metis." } })?.key).toBe("post");
  });
  it("with work in review it says how much; with nothing to do it asks for nothing", () => {
    expect(nextStep({ ...base, account: open(25, "60000000000000000"), campaigns: [job(2)] })?.title).toBe("2 submissions are in review");
    expect(nextStep({ ...base, account: open(25, "60000000000000000"), campaigns: [job(0)] })).toBeNull();
  });
});
