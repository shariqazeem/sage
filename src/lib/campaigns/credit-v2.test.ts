import { describe, expect, it } from "vitest";

import { advanceCapacityUsd, computeCreditSignals } from "./credit";
import type { RecordEntry, WalletRecord } from "./record";

const DAY = 86_400;
const NOW = 1_760_000_000;

const entry = (over: Partial<RecordEntry>): RecordEntry => ({
  at: NOW,
  campaignId: "c1",
  campaignTitle: "A",
  kind: "gig",
  missionTitle: null,
  amountUsd: 100,
  txHash: "0xa",
  proofPath: "/proof/0xa",
  chainId: 2345,
  ...over,
});

const record = (entries: RecordEntry[]): WalletRecord => ({
  wallet: "0x00000000000000000000000000000000000000aa",
  totalUsd: entries.reduce((s, e) => s + e.amountUsd, 0),
  completions: entries.length,
  distinctCampaigns: new Set(entries.map((e) => e.campaignId)).size,
  firstAt: entries.length ? Math.min(...entries.map((e) => e.at)) : null,
  lastAt: entries.length ? Math.max(...entries.map((e) => e.at)) : null,
  entries,
});

const payers: Record<string, string> = { c1: "0xpayer1", c2: "0xpayer2", c3: "0xpayer3" };
const sig = (entries: RecordEntry[]) =>
  computeCreditSignals(record(entries), { paid: entries.length, rejected: 0 }, (c) => payers[c] ?? null, NOW);

describe("recency — a lender underwrites cash flow now, not a lifetime total", () => {
  it("windows inflow to the last 30 and 90 days", () => {
    const s = sig([
      entry({ at: NOW - 5 * DAY, amountUsd: 100 }),
      entry({ at: NOW - 45 * DAY, amountUsd: 200 }),
      entry({ at: NOW - 200 * DAY, amountUsd: 900 }),
    ]);
    expect(s.inflow30dUsd).toBe(100);
    expect(s.inflow90dUsd).toBe(300);
    // The lifetime figure still includes the old one — the windows are additional, not a filter.
    expect(s.verifiedInflowUsd).toBe(1200);
  });

  it("counts completions in the same windows", () => {
    const s = sig([
      entry({ at: NOW - 1 * DAY }),
      entry({ at: NOW - 60 * DAY }),
      entry({ at: NOW - 400 * DAY }),
    ]);
    expect(s.completions30d).toBe(1);
    expect(s.completions90d).toBe(2);
  });

  /** A dormant earner must not look active. This is the number that says the cash flow stopped. */
  it("reports zero recent inflow for a wallet that has stopped earning", () => {
    const s = sig([entry({ at: NOW - 300 * DAY, amountUsd: 5000 })]);
    expect(s.inflow30dUsd).toBe(0);
    expect(s.inflow90dUsd).toBe(0);
    expect(s.verifiedInflowUsd).toBe(5000);
  });
});

describe("concentration — six payers hides whether one of them is 95% of it", () => {
  it("reports the largest payer's share", () => {
    const s = sig([
      entry({ campaignId: "c1", amountUsd: 900 }),
      entry({ campaignId: "c2", amountUsd: 100 }),
    ]);
    expect(s.topPayerShare).toBe(0.9);
  });

  it("scores a single counterparty as fully concentrated", () => {
    const s = sig([entry({ campaignId: "c1", amountUsd: 500 })]);
    expect(s.topPayerShare).toBe(1);
    expect(s.payerConcentration).toBe(1);
  });

  it("falls as income spreads across payers", () => {
    const spread = sig([
      entry({ campaignId: "c1", amountUsd: 100 }),
      entry({ campaignId: "c2", amountUsd: 100 }),
      entry({ campaignId: "c3", amountUsd: 100 }),
    ]);
    const lumpy = sig([
      entry({ campaignId: "c1", amountUsd: 280 }),
      entry({ campaignId: "c2", amountUsd: 10 }),
      entry({ campaignId: "c3", amountUsd: 10 }),
    ]);
    expect(spread.payerConcentration!).toBeLessThan(lumpy.payerConcentration!);
  });

  it("is null rather than invented when no payer is attributable", () => {
    const s = computeCreditSignals(
      record([entry({ campaignId: "unknown" })]),
      { paid: 1, rejected: 0 },
      () => null,
      NOW,
    );
    expect(s.topPayerShare).toBeNull();
    expect(s.payerConcentration).toBeNull();
  });
});

describe("advance capacity is the LENDER's arithmetic, not Sage's verdict", () => {
  /**
   * Sage states facts and computes no creditworthiness score. So the multiple comes from the
   * lender; this only applies it to a verified 90-day inflow, and the arithmetic is published so
   * the number can be checked rather than trusted.
   */
  it("applies the lender's multiple to verified monthly inflow", () => {
    expect(advanceCapacityUsd({ inflow90dUsd: 900 }, 1)).toBe(300);
    expect(advanceCapacityUsd({ inflow90dUsd: 900 }, 2)).toBe(600);
    expect(advanceCapacityUsd({ inflow90dUsd: 900 }, 0.5)).toBe(150);
  });

  it("is zero without a multiple — Sage never picks one on the lender's behalf", () => {
    expect(advanceCapacityUsd({ inflow90dUsd: 900 }, 0)).toBe(0);
    expect(advanceCapacityUsd({ inflow90dUsd: 900 }, -1)).toBe(0);
  });

  it("is zero for a wallet with no recent inflow, however long its history", () => {
    expect(advanceCapacityUsd({ inflow90dUsd: 0 }, 3)).toBe(0);
  });
});
