import { describe, expect, it } from "vitest";
import { deriveOutcomes, type SettledRow } from "./outcomes";

const row = (over: Partial<SettledRow>): SettledRow => ({
  wallet: "0xaa",
  rewardBase: 500_000,
  operator: false,
  createdAt: 1_000,
  decidedAt: 1_600, // 10 minutes
  posterWallet: "0xf1",
  settlementRail: "evm",
  status: "paid",
  ...over,
});

/** Readings, not claims — so each bar's arithmetic is pinned. */
describe("deriveOutcomes", () => {
  it("cost: the corridor comparison is the brief's own benchmark against the settled total", () => {
    const o = deriveOutcomes([row({}), row({ wallet: "0xbb" })], [], 2_000);
    expect(o.settledUsd).toBe(1);
    expect(o.corridor.benchmarkRate).toBe(0.08);
    expect(o.corridor.benchmarkCostUsd).toBeCloseTo(0.08);
    expect(o.corridor.savedUsd).toBeCloseTo(0.08); // recipient-side cost is 0 by construction
    expect(o.recipientFeePct).toBe(0);
  });

  it("speed: median and p90 over VERIFIED-included minutes, refusals excluded", () => {
    const o = deriveOutcomes(
      [
        row({ decidedAt: 1_000 + 5 * 60 }),                    // 5m
        row({ wallet: "0xbb", decidedAt: 1_000 + 15 * 60 }),   // 15m
        row({ wallet: "0xcc", decidedAt: 1_000 + 90 * 60 }),   // 90m
        row({ wallet: "0xdd", status: "rejected", decidedAt: 1_000 + 999 * 60 }),
      ],
      [],
      2_000,
    );
    expect(o.medianMinutesToSettle).toBe(15);
    expect(o.p90MinutesToSettle).toBe(90);
    expect(o.settledWithinHourPct).toBeCloseTo((2 / 3) * 100);
  });

  it("a payout with no decision time cannot poison the speed reading", () => {
    const o = deriveOutcomes([row({ decidedAt: null }), row({ wallet: "0xbb", decidedAt: 500 })], [], 2_000);
    // null and decided-before-created both drop out rather than fabricating a negative minute
    expect(o.medianMinutesToSettle).toBeNull();
  });

  it("access: people are DISTINCT wallets, refusal share counts the judge's integrity", () => {
    const o = deriveOutcomes(
      [row({}), row({ wallet: "0xAA" }), row({ wallet: "0xbb", status: "rejected" })],
      [{ status: "repaid" }, { status: "active" }],
      2_000,
    );
    expect(o.peoplePaid).toBe(1); // 0xaa twice, case-insensitive
    expect(o.refusedCount).toBe(1);
    expect(o.refusalSharePct).toBeCloseTo(33.3, 0);
    expect(o.advancesTotal).toBe(2);
    expect(o.advancesRepaid).toBe(1);
  });

  it("flow: rails and funders come from the rows, denominations from the registry", () => {
    const o = deriveOutcomes(
      [row({}), row({ wallet: "0xbb", settlementRail: "starknet", posterWallet: "0xF1" })],
      [],
      2_000,
    );
    expect(o.railsUsed).toEqual([
      { rail: "evm", payouts: 1 },
      { rail: "starknet", payouts: 1 },
    ]);
    expect(o.distinctFunders).toBe(1); // 0xf1 twice, case-insensitive
    expect(o.denominationsSupported).toBeGreaterThanOrEqual(14);
  });

  it("an empty ledger answers null, never zero-as-fact", () => {
    const o = deriveOutcomes([], [], 2_000);
    expect(o.medianMinutesToSettle).toBeNull();
    expect(o.refusalSharePct).toBeNull();
    expect(o.corridor.savedPct).toBeNull();
  });
});

describe("access counts people, not Sage's own wallets", () => {
  it("an operator payout is settled money on the flow bar but never a person on the access bar", () => {
    const o = deriveOutcomes(
      [row({}), row({ wallet: "0xop", operator: true })],
      [],
      2_000,
    );
    expect(o.settledUsd).toBe(1); // flow: real money either way
    expect(o.payoutCount).toBe(2);
    expect(o.peoplePaid).toBe(1); // access: dogfood is not access
  });
});

describe("the public data layer rides beside the ledger", () => {
  it("carries the vendored World Bank readings with their source and date", () => {
    const r = deriveOutcomes([], [], 1_756_900_000);
    const jm = r.publicCorridors.find((c) => c.country === "JM");
    expect(jm?.pct).toBe(3.59);
    expect(r.publicCorridors.some((c) => c.pct === null)).toBe(true); // an absent reading is reported, not invented
    expect(r.publicCorridorSource.url).toMatch(/worldbank/);
    expect(r.publicCorridorSource.fetchedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
