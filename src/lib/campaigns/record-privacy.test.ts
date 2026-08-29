import { describe, expect, it } from "vitest";

import type { CreditSignals } from "./credit";
import { findMoneyFields, publicRecord, publicSignals } from "./record-privacy";
import type { WalletRecord } from "./record";

const record = (): WalletRecord => ({
  wallet: "0x00000000000000000000000000000000000000aa",
  totalUsd: 412.5,
  completions: 3,
  distinctCampaigns: 2,
  firstAt: 1_750_000_000,
  lastAt: 1_756_000_000,
  entries: [
    {
      at: 1_750_000_000,
      campaignId: "c1",
      campaignTitle: "Test the checkout",
      kind: "testing",
      missionTitle: "Sign up and buy",
      amountUsd: 12.5,
      txHash: "0xaaa",
      proofPath: "/proof/0xaaa",
      chainId: 2345,
    },
    {
      at: 1_753_000_000,
      campaignId: "c2",
      campaignTitle: "Build the landing page",
      kind: "gig",
      missionTitle: null,
      amountUsd: 300,
      txHash: "0xbbb",
      proofPath: "/proof/0xbbb",
      chainId: 2345,
    },
    {
      at: 1_756_000_000,
      campaignId: "c2",
      campaignTitle: "Build the landing page",
      kind: "grant",
      missionTitle: "Milestone 1",
      amountUsd: 100,
      txHash: "0xccc",
      proofPath: "/proof/0xccc",
      chainId: 2345,
    },
  ],
});

const signals = (): CreditSignals => ({
  formulaVersion: "credit-signals-v1",
  verifiedInflowUsd: 412.5,
  completions: 3,
  distinctCampaigns: 2,
  distinctPayers: 2,
  monthsActive: 3,
  avgInflowPerActiveMonthUsd: 137.5,
  verificationPassRate: 0.75,
  decidedSubmissions: 4,
  daysSinceLastVerified: 5,
  tenureDays: 70,
  byKindUsd: { testing: 12.5, gig: 300, grant: 100 },
});

describe("the published record withholds income", () => {
  /**
   * THE TEST THAT DEFINES THIS FILE. Not "the fields I removed are gone" — a sweep for money by
   * NAME, anywhere in the structure. The realistic failure is not someone deciding to publish an
   * amount, it is someone adding a field upstream and never thinking about this file at all.
   */
  it("carries no money field anywhere in the structure", () => {
    expect(findMoneyFields(publicRecord(record()))).toEqual([]);
    expect(findMoneyFields(publicSignals(signals(), record()))).toEqual([]);
  });

  it("still proves each payment happened", () => {
    const pub = publicRecord(record());
    expect(pub.entries.map((e) => e.txHash)).toEqual(["0xaaa", "0xbbb", "0xccc"]);
    expect(pub.entries.every((e) => e.proofPath.startsWith("/proof/"))).toBe(true);
  });

  it("keeps every non-money signal a lender actually uses", () => {
    const s = publicSignals(signals(), record());
    expect(s.completions).toBe(3);
    expect(s.distinctPayers).toBe(2);
    expect(s.monthsActive).toBe(3);
    expect(s.verificationPassRate).toBe(0.75);
    expect(s.tenureDays).toBe(70);
    expect(s.daysSinceLastVerified).toBe(5);
  });

  /** The SHAPE of someone's work is useful and free; the sums are the income itself. */
  it("reports the work split as counts, not sums", () => {
    const s = publicSignals(signals(), record());
    expect(s.byKindCount).toEqual({ testing: 1, gig: 1, grant: 1 });
    expect(JSON.stringify(s)).not.toContain("300");
    expect(JSON.stringify(s)).not.toContain("412.5");
  });

  it("says the amounts are withheld rather than leaving it to be noticed", () => {
    expect(publicRecord(record()).amountsWithheld).toBe(true);
    expect(publicSignals(signals(), record()).amountsWithheld).toBe(true);
  });

  /**
   * The redaction is field-by-field construction, NOT a spread-and-delete. A spread would carry
   * every future field of WalletRecord into the public response automatically, so the day someone
   * adds `medianPayoutUsd` upstream it would publish itself.
   */
  it("does not pass through a money field added upstream", () => {
    const withNewField = {
      ...record(),
      medianPayoutUsd: 100,
      entries: record().entries.map((e) => ({ ...e, bonusUsd: 5 })),
    } as unknown as WalletRecord;
    const pub = publicRecord(withNewField);
    expect(findMoneyFields(pub)).toEqual([]);
    expect(JSON.stringify(pub)).not.toContain("bonus");
    expect(JSON.stringify(pub)).not.toContain("median");
  });

  it("survives a wallet with no history at all", () => {
    const empty: WalletRecord = {
      wallet: "0x00000000000000000000000000000000000000bb",
      totalUsd: 0,
      completions: 0,
      distinctCampaigns: 0,
      firstAt: null,
      lastAt: null,
      entries: [],
    };
    const pub = publicRecord(empty);
    expect(pub.entries).toEqual([]);
    expect(findMoneyFields(pub)).toEqual([]);
    expect(publicSignals({ ...signals(), completions: 0 }, empty).byKindCount).toEqual({
      testing: 0,
      gig: 0,
      grant: 0,
    });
  });
});

describe("the money detector itself", () => {
  /** A check that cannot fail is not a check. This proves the sweep actually catches money. */
  it("catches money by name, at any depth", () => {
    expect(findMoneyFields({ totalUsd: 1 })).toEqual(["totalUsd"]);
    expect(findMoneyFields({ a: { b: [{ amountUsd: 2 }] } })).toEqual(["a.b[0].amountUsd"]);
    expect(findMoneyFields({ verifiedInflowUsd: 3 })).toEqual(["verifiedInflowUsd"]);
    expect(findMoneyFields({ rewardAmount: 4 })).toEqual(["rewardAmount"]);
  });

  it("does not mistake a count or the withheld flag for money", () => {
    expect(findMoneyFields({ byKindCount: { testing: 1 }, amountsWithheld: true })).toEqual([]);
  });

  /**
   * A money-shaped NAME is not money if the value is prose. Flagging the sentence that explains
   * where the amounts went would make this guard noisy enough to be ignored — which is exactly how
   * a real leak gets waved through.
   */
  it("does not flag prose that merely mentions amounts", () => {
    expect(
      findMoneyFields({
        howToObtainAmounts: "https://sagepays.xyz/record/0xabc#disclosure",
        note: "Payout amounts are withheld.",
      }),
    ).toEqual([]);
  });

  it("still catches an amount held as a base-unit string", () => {
    expect(findMoneyFields({ amountBase: "1500000" })).toEqual(["amountBase"]);
  });
});
