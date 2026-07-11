import { describe, expect, it } from "vitest";
import type { Hash } from "viem";

import {
  getAttempt,
  markBroadcast,
  markFailed,
  markRejected,
  markSettled,
  planResume,
  prepareAttempt,
  type PrepareAttemptInput,
} from "./settlement-attempts";
import type { SettlementAttempt, SettlementStatus } from "./schema";
import { createCampaign, createSubmission } from "./campaigns";

/**
 * The DB tests run against a REAL in-memory SQLite (vitest sets
 * SAGE_DB_PATH=":memory:"), so the unique-per-intent constraint and the
 * status transitions are proven by the actual engine, not a mock. Each test
 * uses a distinct intent hash to stay independent within the shared db.
 */

let seq = 0;
function intent(): string {
  seq += 1;
  return `0x${seq.toString(16).padStart(64, "0")}`;
}

// Seed a REAL campaign + submission so the attempt's foreign keys resolve
// (FKs are enforced in the test db) — the same seed pattern as concurrency.test.
let seedSeq = 0;
function inputFor(payoutIntentHash: string): PrepareAttemptInput {
  seedSeq += 1;
  const c = createCampaign({
    title: "attempt-test",
    rewardAmount: 500_000,
    vaultAddress: `0x${"1".repeat(40)}`,
    posterWallet: `0x${"2".repeat(40)}`,
  });
  const wallet = `0x${seedSeq.toString(16).padStart(40, "0")}`;
  const r = createSubmission({ campaignId: c.id, wallet });
  if (!r.ok) throw new Error(`seed failed: ${r.error}`);
  return {
    payoutIntentHash,
    decisionDigest: `0x${"d".repeat(64)}`,
    submissionId: r.submission.id,
    campaignId: c.id,
    chainId: 59902,
    vaultAddress: `0x${"1".repeat(40)}`,
    recipient: wallet,
    amountBase: 500_000,
  };
}

describe("settlement-attempts ledger (real in-memory sqlite)", () => {
  it("prepareAttempt creates exactly one 'prepared' row", () => {
    const h = intent();
    const { attempt, created } = prepareAttempt(inputFor(h));
    expect(created).toBe(true);
    expect(attempt.status).toBe("prepared");
    expect(attempt.txHash).toBeNull();
    expect(attempt.payoutIntentHash).toBe(h);
    expect(attempt.amountBase).toBe(500_000);
  });

  it("prepareAttempt is idempotent per intent — a re-trigger finds the same row", () => {
    const h = intent();
    const first = prepareAttempt(inputFor(h));
    const second = prepareAttempt(inputFor(h));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false); // did NOT create a duplicate
    expect(second.attempt.id).toBe(first.attempt.id);
  });

  it("markBroadcast persists the txHash before any receipt (the crash-critical write)", () => {
    const h = intent();
    prepareAttempt(inputFor(h));
    markBroadcast(h, "0xBROADCAST" as Hash);
    const row = getAttempt(h);
    expect(row?.status).toBe("broadcast");
    expect(row?.txHash).toBe("0xBROADCAST");
  });

  it("markSettled records the paid outcome", () => {
    const h = intent();
    prepareAttempt(inputFor(h));
    markBroadcast(h, "0xTX" as Hash);
    markSettled(h, "0xTX" as Hash);
    const row = getAttempt(h);
    expect(row?.status).toBe("settled");
    expect(row?.txHash).toBe("0xTX");
    expect(row?.failedCheckIndex).toBeNull();
  });

  it("markRejected records the failing policy check", () => {
    const h = intent();
    prepareAttempt(inputFor(h));
    markBroadcast(h, "0xTX" as Hash);
    markRejected(h, "0xTX" as Hash, 7);
    const row = getAttempt(h);
    expect(row?.status).toBe("rejected");
    expect(row?.failedCheckIndex).toBe(7);
  });

  it("markFailed is non-terminal and records the error", () => {
    const h = intent();
    prepareAttempt(inputFor(h));
    markFailed(h, "RPC timeout");
    const row = getAttempt(h);
    expect(row?.status).toBe("failed");
    expect(row?.lastError).toContain("RPC timeout");
  });

  it("getAttempt returns null for an unknown intent, and distinct intents don't collide", () => {
    expect(getAttempt(intent())).toBeNull();
    const a = intent();
    const b = intent();
    prepareAttempt(inputFor(a));
    prepareAttempt(inputFor(b));
    expect(getAttempt(a)?.payoutIntentHash).toBe(a);
    expect(getAttempt(b)?.payoutIntentHash).toBe(b);
  });
});

/* planResume is pure — plain objects, no db, no chain. */
function row(
  status: SettlementStatus,
  extra: Partial<SettlementAttempt> = {},
): SettlementAttempt {
  return {
    id: "id",
    payoutIntentHash: `0x${"1".repeat(64)}`,
    decisionDigest: null,
    submissionId: "s",
    campaignId: "c",
    chainId: 59902,
    vaultAddress: `0x${"1".repeat(40)}`,
    recipient: `0x${"a".repeat(40)}`,
    amountBase: 500_000,
    status,
    txHash: null,
    failedCheckIndex: null,
    lastError: null,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

describe("planResume — never blind-resend", () => {
  it("no attempt → broadcast a fresh tx", () => {
    expect(planResume(null)).toEqual({ kind: "broadcast" });
  });

  it("prepared with no tx → broadcast", () => {
    expect(planResume(row("prepared"))).toEqual({ kind: "broadcast" });
  });

  it("prepared but a tx already exists (broadcast raced the status write) → await, not resend", () => {
    expect(planResume(row("prepared", { txHash: "0xRACE" }))).toEqual({
      kind: "await",
      txHash: "0xRACE",
    });
  });

  it("broadcast with a tx → await that tx's receipt", () => {
    expect(planResume(row("broadcast", { txHash: "0xSENT" }))).toEqual({
      kind: "await",
      txHash: "0xSENT",
    });
  });

  it("broadcast with NO tx (anomalous) → verify on-chain before anything", () => {
    expect(planResume(row("broadcast"))).toEqual({ kind: "verify", txHash: null });
  });

  it("settled → settled, carrying the tx", () => {
    expect(planResume(row("settled", { txHash: "0xPAID" }))).toEqual({
      kind: "settled",
      txHash: "0xPAID",
    });
  });

  it("rejected → rejected, carrying the failed check", () => {
    expect(
      planResume(row("rejected", { txHash: "0xREJ", failedCheckIndex: 5 })),
    ).toEqual({ kind: "rejected", txHash: "0xREJ", failedCheckIndex: 5 });
  });

  it("failed → verify on-chain (the tx may have landed despite the error)", () => {
    expect(planResume(row("failed", { txHash: "0xMAYBE" }))).toEqual({
      kind: "verify",
      txHash: "0xMAYBE",
    });
  });
});
