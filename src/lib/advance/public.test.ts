import { beforeEach, describe, expect, it } from "vitest";
import { publicAdvances } from "./public";
import { createAdvance, recordDisbursement, recordRepayment } from "@/lib/db/advances";
import { db } from "@/lib/db";
import { advances, advanceRepayments } from "@/lib/db/schema";

const W = "0x4f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434";

beforeEach(() => {
  db.delete(advanceRepayments).run();
  db.delete(advances).run();
});

const seed = () => {
  const a = createAdvance({
    borrowerWallet: W, principalBase: BigInt(200_000), multiple: 1, waterfallBps: 5000,
    potAddress: "0x46a1",
  });
  recordDisbursement(a.id, { tx: "0xd15b", claimCommitment: "0xc0", claimSecret: "0xdeadbeef" });
  recordRepayment({
    advanceId: a.id, submissionId: "s1", amountBase: BigInt(200_000),
    claimCommitment: "0xc1", claimSecret: "0xp0t5ecret", escrowTx: "0xe5c",
  });
  return a;
};

describe("publicAdvances — the one redaction boundary", () => {
  it("NEVER carries a secret, in any field, under any setting", () => {
    seed();
    for (const withheld of [false, true]) {
      const json = JSON.stringify(publicAdvances(W, { amountsWithheld: withheld }));
      expect(json).not.toContain("0xdeadbeef"); // the borrower's disbursement link
      expect(json).not.toContain("0xp0t5ecret"); // the pot's repayment leg
      expect(json).not.toMatch(/claimSecret|disburseClaimSecret/);
    }
  });

  it("shows the money when the record is public", () => {
    seed();
    const [a] = publicAdvances(W, { amountsWithheld: false });
    expect(a.principalUsd).toBe(0.2);
    expect(a.outstandingUsd).toBe(0);
    expect(a.status).toBe("repaid");
    expect(a.repayments[0].amountUsd).toBe(0.2);
    expect(a.terms).toEqual({ multipleOfMonthlyInflow: 1, waterfallPct: 50 });
  });

  it("withholds the figures — not the FACT — when the earner chose privacy", () => {
    seed();
    const [a] = publicAdvances(W, { amountsWithheld: true });
    expect(a.principalUsd).toBeNull();
    expect(a.outstandingUsd).toBeNull();
    expect(a.repayments[0].amountUsd).toBeNull();
    // the credit story survives redaction: it existed, it repaid, the txs are checkable
    expect(a.status).toBe("repaid");
    expect(a.repayments[0].escrowTx).toBe("0xe5c");
  });

  it("keeps every transaction checkable", () => {
    seed();
    const [a] = publicAdvances(W, { amountsWithheld: false });
    expect(a.disburseTx).toBe("0xd15b");
    expect(a.disburseTxUrl).toContain("0xd15b");
    expect(a.repayments[0].escrowTxUrl).toContain("0xe5c");
  });
});
