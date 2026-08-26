import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { createCampaign, createMission, createSubmission, updateSubmission } from "@/lib/db/campaigns";
import { missionIdHash } from "./mission-plan";
import { computeCreditSignals, walletCreditSignals, CREDIT_SIGNALS_VERSION } from "./credit";
import type { WalletRecord } from "./record";

/**
 * SAGE SIGNALS (FC plan #1) — deterministic published formulas over receipt-anchored rows.
 * The pure core is pinned EXACTLY (months, payers, pass rate, per-kind split); the IO wrapper is
 * pinned for the two live traps: checksum-cased stored wallets, and rejected rows entering ONLY
 * the pass-rate denominator (never the record).
 */

const NOW = 1_790_000_000; // fixed clock — signals must be reproducible in tests

function entry(at: number, campaignId: string, kind: "testing" | "gig" | "grant", amountUsd: number) {
  return { at, campaignId, campaignTitle: "t", kind, missionTitle: null, amountUsd, txHash: `0x${at}`, proofPath: "/proof/x", chainId: 2345 };
}

describe("computeCreditSignals — pure, exact", () => {
  it("computes months, payers (case-insensitive), pass rate, per-kind split from anchored entries only", () => {
    const record: WalletRecord = {
      wallet: "0x00000000000000000000000000000000000000aa",
      totalUsd: 7.5,
      completions: 3,
      distinctCampaigns: 2,
      firstAt: NOW - 40 * 86_400,
      lastAt: NOW - 5 * 86_400,
      entries: [
        entry(NOW - 5 * 86_400, "c1", "gig", 5),
        entry(NOW - 6 * 86_400, "c2", "testing", 1.5),
        entry(NOW - 40 * 86_400, "c1", "gig", 1),
      ],
    };
    const payers: Record<string, string> = { c1: "0xAbC0000000000000000000000000000000000001", c2: "0xabc0000000000000000000000000000000000001" };
    const s = computeCreditSignals(record, { paid: 3, rejected: 1 }, (id) => payers[id] ?? null, NOW);

    expect(s.formulaVersion).toBe(CREDIT_SIGNALS_VERSION);
    expect(s.verifiedInflowUsd).toBe(7.5);
    expect(s.completions).toBe(3);
    expect(s.distinctCampaigns).toBe(2);
    expect(s.distinctPayers).toBe(1); // same funder in two casings — one counterparty, not two
    expect(s.monthsActive).toBe(2); // 40 days apart spans two UTC months at this clock
    expect(s.avgInflowPerActiveMonthUsd).toBe(3.75);
    expect(s.verificationPassRate).toBe(0.75); // 3 paid / 4 decided
    expect(s.decidedSubmissions).toBe(4);
    expect(s.daysSinceLastVerified).toBe(5);
    expect(s.tenureDays).toBe(40);
    expect(s.byKindUsd).toEqual({ testing: 1.5, gig: 6, grant: 0 });
  });

  it("an empty record yields zeros and honest nulls — never a fabricated rate", () => {
    const empty: WalletRecord = { wallet: "0x" + "9".repeat(40), totalUsd: 0, completions: 0, distinctCampaigns: 0, firstAt: null, lastAt: null, entries: [] };
    const s = computeCreditSignals(empty, { paid: 0, rejected: 0 }, () => null, NOW);
    expect(s.verificationPassRate).toBeNull();
    expect(s.daysSinceLastVerified).toBeNull();
    expect(s.tenureDays).toBeNull();
    expect(s.monthsActive).toBe(0);
    expect(s.avgInflowPerActiveMonthUsd).toBe(0);
  });
});

describe("walletCreditSignals — IO wrapper over the real rows", () => {
  it("counts checksum-cased paid rows and rejected rows into the pass rate; rejects a non-address", () => {
    const W = "0x00000000000000000000000000000000000000cd";
    const c = createCampaign({ title: "sig-c", rewardAmount: 2_000_000, vaultAddress: `0x${"5".repeat(40)}`, posterWallet: `0x${"4".repeat(40)}`, chainId: 2345, status: "live" });
    db.update(campaigns).set({ kind: "gig" }).where(eq(campaigns.id, c.id)).run();
    const hash = missionIdHash(c.id, "m1");
    createMission({ campaignId: c.id, missionKey: "m1", missionIdHash: hash, title: "M", rewardAmount: 2_000_000, maxCompletions: 3, displayOrder: 0, verifiabilityClass: "url-verifiable" });

    // paid row stored CHECKSUM-CASED (exactly how SIWE sessions store wallets on prod)
    const paid = createSubmission({ campaignId: c.id, wallet: "0x00000000000000000000000000000000000000CD", evidenceUrl: "https://x.org/a", note: "", missionIdHash: hash, missionSpecDigest: null });
    if (!paid.ok) throw new Error("seed failed");
    updateSubmission(paid.submission.id, { status: "paid", payoutTx: `0x${"d".repeat(64)}`, decidedAt: NOW - 86_400 });

    // second submission from the same wallet: no mission binding (the per-wallet-per-mission cap
    // would refuse a resubmit of m1 — that Sybil control staying on inside tests is a feature)
    const rej = createSubmission({ campaignId: c.id, wallet: W, evidenceUrl: "https://x.org/b", note: "", missionIdHash: null, missionSpecDigest: null });
    if (!rej.ok) throw new Error("seed failed");
    updateSubmission(rej.submission.id, { status: "rejected" });

    const out = walletCreditSignals(W.toUpperCase(), NOW)!;
    expect(out.signals.completions).toBe(1);
    expect(out.signals.verifiedInflowUsd).toBe(2);
    expect(out.signals.decidedSubmissions).toBe(2);
    expect(out.signals.verificationPassRate).toBe(0.5);
    expect(out.signals.distinctPayers).toBe(1);
    expect(out.record.entries[0]!.kind).toBe("gig");

    expect(walletCreditSignals("not-a-wallet", NOW)).toBeNull();
  });
});
