import { describe, it, expect } from "vitest";
import {
  recordPendingFee,
  listPendingFees,
  nextFeeAttempt,
  recordFeeFailure,
  markFeeSettled,
  stuckFees,
} from "./campaigns";

/**
 * THE FEE THAT COULD NEVER BE PAID TWICE.
 *
 * `runOperatorFee` derives its GOAT dappOrderId from the fee id. That id used to be `fee-<id>` and
 * therefore FIXED for the life of the fee, so the first sweep created the order, the order expired
 * unpaid, and every retry after that died on the facilitator's "failed to create order: order
 * already exists" BEFORE reaching the transfer. Measured on prod 2026-08-09: nine fees stranded
 * from 6 July, ~8,000 silent retries, 67 unpayable invoices reading as US$5.10 of "revenue".
 *
 * Two things had to be true for that to survive a month, so both are pinned here: the id must
 * differ per attempt, and a failure must leave a readable trace. Runs against the real in-memory
 * SQLite, so the counter is proven by the actual engine.
 */
describe("operator fee retries", () => {
  const feeFor = (settleTx: string) => {
    recordPendingFee({ settleTx, campaignId: null, submissionId: null, amountBase: 100_000 });
    const f = listPendingFees().find((x) => x.settleTx === settleTx);
    if (!f) throw new Error("fee not recorded");
    return f;
  };

  it("hands out a DIFFERENT attempt number every time, so the dappOrderId can never collide", () => {
    const fee = feeFor("0xretry-unique");
    const ids = [1, 2, 3, 4, 5].map(() => `fee-${fee.id}-${nextFeeAttempt(fee.id)}`);
    expect(new Set(ids).size).toBe(5);
    // and it counts up rather than restarting, which is what a fresh order at the facilitator needs
    expect(ids[0]).toBe(`fee-${fee.id}-1`);
    expect(ids[4]).toBe(`fee-${fee.id}-5`);
  });

  it("persists the attempt count, so a restart does not reissue a dead id", () => {
    const fee = feeFor("0xretry-persist");
    nextFeeAttempt(fee.id);
    nextFeeAttempt(fee.id);
    // a "restart" is just re-reading the row through the same API
    expect(nextFeeAttempt(fee.id)).toBe(3);
    expect(listPendingFees().find((f) => f.id === fee.id)?.attempts).toBe(3);
  });

  it("keeps the failure reason on the row instead of discarding it", () => {
    const fee = feeFor("0xretry-error");
    recordFeeFailure(fee.id, "failed to create order: order already exists");
    const row = listPendingFees().find((f) => f.id === fee.id);
    expect(row?.lastError).toContain("order already exists");
  });

  it("overwrites rather than accumulates, so a 5-minute retry loop cannot spam", () => {
    const fee = feeFor("0xretry-overwrite");
    recordFeeFailure(fee.id, "first reason");
    recordFeeFailure(fee.id, "second reason");
    const row = listPendingFees().find((f) => f.id === fee.id);
    expect(row?.lastError).toBe("second reason");
  });

  it("bounds a hostile error string rather than storing it whole", () => {
    const fee = feeFor("0xretry-bound");
    recordFeeFailure(fee.id, "x".repeat(5000));
    const row = listPendingFees().find((f) => f.id === fee.id);
    expect((row?.lastError ?? "").length).toBeLessThanOrEqual(300);
  });

  it("surfaces a fee that keeps failing, so it cannot fail silently for a month again", () => {
    const fee = feeFor("0xretry-stuck");
    for (let i = 0; i < 4; i++) nextFeeAttempt(fee.id);
    recordFeeFailure(fee.id, "order already exists");
    const stuck = stuckFees(3).find((f) => f.id === fee.id);
    expect(stuck).toBeDefined();
    expect(stuck?.attempts).toBeGreaterThanOrEqual(4);
    expect(stuck?.lastError).toContain("order already exists");
  });

  it("does NOT report a fee that has only just started, so the signal stays meaningful", () => {
    const fee = feeFor("0xretry-young");
    nextFeeAttempt(fee.id);
    expect(stuckFees(3).find((f) => f.id === fee.id)).toBeUndefined();
  });

  it("settling clears the error and takes the fee out of the pending queue for good", () => {
    const fee = feeFor("0xretry-settled");
    nextFeeAttempt(fee.id);
    recordFeeFailure(fee.id, "transient");
    markFeeSettled(fee.id, "0xpaymenttx", "ord_1");
    expect(listPendingFees().find((f) => f.id === fee.id)).toBeUndefined();
    expect(stuckFees(1).find((f) => f.id === fee.id)).toBeUndefined();
  });
});
