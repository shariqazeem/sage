import { beforeEach, describe, expect, it } from "vitest";
import {
  advanceHistory,
  createAdvance,
  getActiveAdvance,
  recordRepayment,
} from "./advances";
import { db } from "@/lib/db";
import { advances, advanceRepayments } from "@/lib/db/schema";

/** Real in-memory SQLite (vitest sets SAGE_DB_PATH=":memory:"), so the schema's own guards —
 *  the partial unique index and the per-submission uniqueness — are the things under test. */

const W = "0x4f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434";
const PADDED = "0x04F1f6530F84e4A1DB7fa35bAFc313174A2482A54c775C4321487Eb0fE91f434";

const mk = (over: Record<string, unknown> = {}) =>
  createAdvance({
    borrowerWallet: W,
    principalBase: BigInt(1_000_000),
    multiple: 1,
    waterfallBps: 5000,
    potAddress: "0x46a1747d854e74e5082c3215841b26dcff182a6a6fd7a1f83c3e1d045996101",
    ...over,
  } as never);

const rep = (advanceId: string, submissionId: string, amount: bigint) =>
  recordRepayment({
    advanceId,
    submissionId,
    amountBase: amount,
    claimCommitment: "0xc0",
    claimSecret: "0x5ec",
    escrowTx: "0xe5c",
  });

beforeEach(() => {
  db.delete(advanceRepayments).run();
  db.delete(advances).run();
});

describe("advances ledger", () => {
  it("one ACTIVE advance per borrower — the schema refuses stacking", () => {
    mk();
    expect(() => mk()).toThrow(/UNIQUE/i);
  });

  it("a repaid advance frees the borrower for a new one", () => {
    const a = mk();
    rep(a.id, "sub-1", BigInt(1_000_000));
    expect(getActiveAdvance(W)).toBeNull();
    expect(() => mk()).not.toThrow();
  });

  it("finds the advance whichever spelling of the felt the caller holds", () => {
    const a = mk();
    // The marker-variants lesson: a felt has two spellings and both are the same account.
    expect(getActiveAdvance(PADDED)?.id).toBe(a.id);
    expect(getActiveAdvance(W)?.id).toBe(a.id);
  });

  it("repayments decrement exactly and flip status at zero", () => {
    const a = mk();
    const r1 = rep(a.id, "sub-1", BigInt(400_000));
    expect(r1).toEqual({ remainingBase: BigInt(600_000), repaid: false });
    const r2 = rep(a.id, "sub-2", BigInt(600_000));
    expect(r2).toEqual({ remainingBase: BigInt(0), repaid: true });
    const rows = advanceHistory(W);
    expect(rows[0].status).toBe("repaid");
    expect(rows[0].repayments).toHaveLength(2);
  });

  it("one payout repays ONCE — a second slice from the same submission is refused", () => {
    const a = mk();
    rep(a.id, "sub-1", BigInt(100_000));
    expect(() => rep(a.id, "sub-1", BigInt(100_000))).toThrow(/UNIQUE/i);
    // and the balance was not touched by the failed attempt
    expect(getActiveAdvance(W)?.outstandingBase).toBe(900_000);
  });

  it("a repayment can never exceed the balance — the ledger throws before it lies", () => {
    const a = mk();
    expect(() => rep(a.id, "sub-1", BigInt(2_000_000))).toThrow(/exceeds outstanding/);
    expect(getActiveAdvance(W)?.outstandingBase).toBe(1_000_000);
  });

  it("refuses non-money shapes", () => {
    expect(() => mk({ principalBase: BigInt(0) })).toThrow();
    expect(() => mk({ waterfallBps: 0 })).toThrow();
    expect(() => mk({ waterfallBps: 10_001 })).toThrow();
    const a = mk();
    expect(() => rep(a.id, "s", BigInt(0))).toThrow();
  });
});
