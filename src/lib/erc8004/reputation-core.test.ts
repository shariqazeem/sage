import { describe, expect, it } from "vitest";
import type { EventKind } from "@/lib/db/schema";
import {
  aggregateByChain,
  deriveReputation,
  toReceipts,
  type RepDecision,
  type RepEvent,
} from "./reputation-core";

function ev(kind: EventKind, over: Partial<RepEvent> = {}): RepEvent {
  return {
    kind,
    amount: over.amount ?? null,
    txHash: over.txHash ?? null,
    campaignId: over.campaignId ?? "c1",
    chainId: over.chainId ?? null,
    createdAt: over.createdAt ?? 1000,
    failedCheckIndex: over.failedCheckIndex ?? null,
  };
}

describe("deriveReputation — the empty state renders honestly", () => {
  it("returns all zeros / nulls and active=false for no data", () => {
    const r = deriveReputation({ events: [], paidRecipients: [], decisions: [] });
    expect(r).toEqual({
      settledTotalBase: 0,
      payoutCount: 0,
      blockedCount: 0,
      distinctCampaigns: 0,
      distinctRecipients: 0,
      firstActivityAt: null,
      lastActivityAt: null,
      decisionCount: 0,
      avgConfidence: null,
      engineMix: { llm: 0, heuristic: 0 },
      active: false,
    });
  });
});

describe("deriveReputation — payout record from real events", () => {
  const events: RepEvent[] = [
    ev("settled", { amount: 10_000_000, txHash: "0xa", campaignId: "c1", createdAt: 100 }),
    ev("autopay_settled", { amount: 5_000_000, txHash: "0xb", campaignId: "c2", createdAt: 300 }),
    ev("blocked", { amount: 999_000, txHash: "0xc", campaignId: "c1", createdAt: 200, failedCheckIndex: 4 }),
    // noise: non-payout kinds must NOT affect payout stats
    ev("submission_received", { campaignId: "c3", createdAt: 400 }),
    ev("decision_recorded", { campaignId: "c3", createdAt: 50 }),
  ];

  it("sums only settled/autopay amounts and counts payouts + blocks", () => {
    const r = deriveReputation({ events, paidRecipients: [], decisions: [] });
    expect(r.settledTotalBase).toBe(15_000_000); // 10 + 5, NOT the blocked 0.999
    expect(r.payoutCount).toBe(2);
    expect(r.blockedCount).toBe(1);
  });

  it("dedupes one payout that emitted multiple rows (settled + autopay_settled, same tx)", () => {
    // An autopilot payout records BOTH `settled` (settle-flow) and
    // `autopay_settled` (pipeline) for the same on-chain tx — count it once.
    const dup: RepEvent[] = [
      ev("settled", { amount: 500_000, txHash: "0xpay", campaignId: "c9", createdAt: 100 }),
      ev("autopay_settled", { amount: 500_000, txHash: "0xpay", campaignId: "c9", createdAt: 101 }),
    ];
    const r = deriveReputation({ events: dup, paidRecipients: [], decisions: [] });
    expect(r.payoutCount).toBe(1);
    expect(r.settledTotalBase).toBe(500_000);
  });

  it("counts distinct campaigns across settled + blocked only", () => {
    // c1 (settled + blocked), c2 (settled) → 2; c3 (noise) excluded.
    expect(deriveReputation({ events, paidRecipients: [], decisions: [] }).distinctCampaigns).toBe(2);
  });

  it("spans first/last activity over payout events only", () => {
    const r = deriveReputation({ events, paidRecipients: [], decisions: [] });
    expect(r.firstActivityAt).toBe(100); // not the createdAt:50 decision_recorded
    expect(r.lastActivityAt).toBe(300); // not the createdAt:400 submission_received
  });

  it("is active when any payout/block exists", () => {
    expect(deriveReputation({ events, paidRecipients: [], decisions: [] }).active).toBe(true);
  });
});

describe("deriveReputation — distinct recipients dedupe case-insensitively", () => {
  it("counts each wallet once regardless of case, ignoring blanks", () => {
    const r = deriveReputation({
      events: [],
      paidRecipients: ["0xAbC", "0xabc", "0xDEF", ""],
      decisions: [],
    });
    expect(r.distinctRecipients).toBe(2);
  });
});

describe("deriveReputation — decision stats", () => {
  const decisions: RepDecision[] = [
    { engine: "llm", confidence: 0.9 },
    { engine: "llm", confidence: 0.8 },
    { engine: "heuristic", confidence: 0.4 },
  ];
  it("counts decisions, averages confidence, and splits the engine mix", () => {
    const r = deriveReputation({ events: [], paidRecipients: [], decisions });
    expect(r.decisionCount).toBe(3);
    expect(r.avgConfidence).toBeCloseTo(0.7, 3); // (0.9+0.8+0.4)/3
    expect(r.engineMix).toEqual({ llm: 2, heuristic: 1 });
    expect(r.active).toBe(true); // decisions alone make the record non-empty
  });
  it("avgConfidence is null with no decisions", () => {
    expect(deriveReputation({ events: [], paidRecipients: [], decisions: [] }).avgConfidence).toBeNull();
  });
});

describe("toReceipts — verifiable, tx-linkable, newest first", () => {
  const events: RepEvent[] = [
    ev("settled", { amount: 3_000_000, txHash: "0x1", createdAt: 100 }),
    ev("blocked", { amount: 0, txHash: "0x2", createdAt: 300, failedCheckIndex: 3 }),
    ev("settled", { amount: 1_000_000, txHash: null, createdAt: 200 }), // no tx → excluded
    ev("decision_recorded", { txHash: "0x9", createdAt: 400 }), // not a payout → excluded
  ];

  it("keeps only tx-bearing settled/blocked, newest first", () => {
    const r = toReceipts(events);
    expect(r.map((x) => x.txHash)).toEqual(["0x2", "0x1"]);
    expect(r[0]).toMatchObject({ settled: false, failedCheckIndex: 3, txHash: "0x2" });
    expect(r[1]).toMatchObject({ settled: true, amountBase: 3_000_000, txHash: "0x1" });
  });

  it("caps at the requested limit", () => {
    expect(toReceipts(events, 1)).toHaveLength(1);
    expect(toReceipts(events, 1)[0].txHash).toBe("0x2");
  });

  it("dedupes one payout that emitted settled + autopay_settled (same tx) into ONE receipt", () => {
    const dup: RepEvent[] = [
      ev("settled", { amount: 500_000, txHash: "0xpay", createdAt: 100 }),
      ev("autopay_settled", { amount: 500_000, txHash: "0xpay", createdAt: 101 }),
    ];
    const r = toReceipts(dup);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ settled: true, txHash: "0xpay" });
  });

  it("keys receipts by chainId+tx — the same tx on two chains is two receipts", () => {
    const cross: RepEvent[] = [
      ev("settled", { amount: 500_000, txHash: "0xsame", chainId: 59902, createdAt: 100 }),
      ev("settled", { amount: 500_000, txHash: "0xsame", chainId: 2345, createdAt: 101 }),
    ];
    expect(toReceipts(cross)).toHaveLength(2);
  });
});

describe("aggregateByChain — never silently mixes testnet with mainnet", () => {
  it("splits settled/blocked per chain, mainnet total excludes testnet", () => {
    const events: RepEvent[] = [
      ev("settled", { amount: 500_000, txHash: "0xg1", chainId: 2345, createdAt: 100 }), // GOAT mainnet
      ev("autopay_settled", { amount: 500_000, txHash: "0xg1", chainId: 2345, createdAt: 101 }), // dup of 0xg1
      ev("settled", { amount: 3_000_000, txHash: "0xm1", chainId: 59902, createdAt: 90 }), // Metis testnet
      ev("blocked", { amount: 0, txHash: "0xm2", chainId: 59902, createdAt: 80, failedCheckIndex: 4 }),
    ];
    const split = aggregateByChain(events);
    expect(split.get(2345)).toEqual({ settledBase: 500_000, payouts: 1, blocks: 0 }); // dup counted once
    expect(split.get(59902)).toEqual({ settledBase: 3_000_000, payouts: 1, blocks: 1 });
    // the mainnet figure does not include the 3 USDC testnet payout
    expect(split.get(2345)!.settledBase).toBe(500_000);
  });

  it("excludes rows with an unknown chain or no tx from the split", () => {
    const events: RepEvent[] = [
      ev("settled", { amount: 1_000_000, txHash: "0xa", chainId: null, createdAt: 10 }), // unknown chain
      ev("settled", { amount: 1_000_000, txHash: null, chainId: 2345, createdAt: 20 }), // no tx
    ];
    expect(aggregateByChain(events).size).toBe(0);
  });
});
