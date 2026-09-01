import { describe, expect, it } from "vitest";
import {
  FiatAdapterNotConfigured,
  SETTLEMENT_DOORS,
  doorFor,
  fiatDisburse,
  fiatQuote,
} from "./adapters";
import type { SettlementRail } from "@/lib/db/schema";

describe("the settlement doors — a registry that must match reality", () => {
  it("every rail the dispatcher knows has exactly one LIVE door (the two-lists rule)", () => {
    const rails: SettlementRail[] = ["evm", "starknet"];
    for (const rail of rails) {
      const doors = SETTLEMENT_DOORS.filter((d) => d.settles === rail);
      expect(doors, rail).toHaveLength(1);
      expect(doors[0].status).toBe("live");
    }
  });

  it("a door that is not live SAYS WHY — and a live one carries no excuse", () => {
    for (const d of SETTLEMENT_DOORS) {
      if (d.status === "live") expect(d.notLiveBecause).toBeUndefined();
      else expect(d.notLiveBecause).toMatch(/no partner keys/);
    }
  });

  it("capability truths that must never drift", () => {
    expect(doorFor("starknet-claims").capabilities.privateCapable).toBe(true);
    expect(doorFor("goat").capabilities.privateCapable).toBe(false);
    expect(doorFor("fiat-partner").capabilities.fiatExit).toBe(true);
    expect(doorFor("fiat-partner").capabilities.chainAnchored).toBe(false);
    // the walletless promise holds at EVERY door — it is the product, not a rail feature
    for (const d of SETTLEMENT_DOORS) expect(d.capabilities.walletlessRecipient).toBe(true);
  });

  it("the fiat quote is real arithmetic with an explicit benchmark", () => {
    const q = fiatQuote(100, 0.08);
    expect(q.benchmarkCostUsd).toBeCloseTo(8);
    expect(q.savedUsd).toBeCloseTo(8);
    // a future partner fee lands honestly on Sage's side of the ledger
    expect(fiatQuote(100, 0.08, 1.5).savedUsd).toBeCloseTo(6.5);
  });

  it("the fiat disburse REFUSES in words — it will not pretend to move money", async () => {
    await expect(fiatDisburse()).rejects.toBeInstanceOf(FiatAdapterNotConfigured);
    await expect(fiatDisburse()).rejects.toThrow(/will not pretend to move money/);
  });
});
