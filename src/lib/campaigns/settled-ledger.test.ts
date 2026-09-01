import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { db } from "@/lib/db";
import { campaigns, events, submissions } from "@/lib/db/schema";
import { createCampaign, createSubmission, recordEvent } from "@/lib/db/campaigns";
import { eq } from "drizzle-orm";
import { mainnetSettled, mainnetSettledToTesters, settledLedger } from "./settled-ledger";
import { getTesterSupply } from "./tester-supply";

/**
 * THE DRIFT TEST. Three public surfaces showed three different settled totals on the same day
 * (2026-09-01) because each derived its own. The fix is one ledger — and this file is the part
 * that keeps it fixed: the launch page's numbers are asserted EQUAL to the ledger's on the same
 * seeded rows. A future surface that re-derives instead of importing has no such guarantee,
 * which is the review question this test teaches.
 */

const TESTER = "0x00000000000000000000000000000000000000a1";
const TESTER2 = "0x00000000000000000000000000000000000000a2";
const OPERATOR = "0xdf70f6e8e656e5bb714ff0e8ca176d76f26890e3";

const seedCampaign = (id: string, chainId: number, sandbox = false) => {
  const c = createCampaign({
    title: `C ${id}`,
    rewardAmount: 500_000,
    vaultAddress: "0x0000000000000000000000000000000000000001",
    posterWallet: "0x00000000000000000000000000000000000000f1",
    autonomy: "manual",
    sandbox,
    chainId,
  } as never);
  db.update(campaigns).set({ id }).where(eq(campaigns.id, c.id)).run();
  return id;
};

const seedPaid = (campaignId: string, wallet: string, tx: string, amount: number, kind: "settled" | "autopay_settled" = "settled") => {
  const r = createSubmission({
    campaignId,
    wallet,
    evidenceUrl: `https://x.example/${tx}`,
  });
  if (!r.ok) throw new Error(`fixture submission refused: ${r.error}`);
  const s = r.submission;
  db.update(submissions).set({ status: "paid", payoutTx: tx }).where(eq(submissions.id, s.id)).run();
  recordEvent({ campaignId, submissionId: s.id, kind, txHash: tx, amount });
  return s.id;
};

beforeEach(() => {
  db.delete(events).run();
  db.delete(submissions).run();
  db.delete(campaigns).run();
});

describe("settledLedger", () => {
  it("one row per (chain, tx) — the app event and the chain-reconciled row never double-count", () => {
    seedCampaign("m1", 2345);
    const sid = seedPaid("m1", TESTER, "0xtx1", 500_000, "settled");
    recordEvent({ campaignId: "m1", submissionId: sid, kind: "autopay_settled", txHash: "0xtx1", amount: 500_000 });
    const rows = settledLedger();
    expect(rows).toHaveLength(1);
    expect(rows[0].amountBase).toBe(500_000);
    expect(rows[0].wallet?.toLowerCase()).toBe(TESTER);
  });

  it("testnet settlements exist as rows but never as mainnet money", () => {
    seedCampaign("m1", 2345);
    seedCampaign("t1", 59902);
    seedPaid("m1", TESTER, "0xtx1", 500_000);
    seedPaid("t1", TESTER, "0xtx2", 9_000_000);
    expect(mainnetSettled().usdcSettled).toBe(0.5);
    expect(mainnetSettled().payouts).toBe(1);
  });

  it("operator dogfood is real settled money but never 'paid to testers'", () => {
    seedCampaign("m1", 2345);
    seedPaid("m1", TESTER, "0xtx1", 500_000);
    seedPaid("m1", OPERATOR, "0xtx2", 1_000_000);
    expect(mainnetSettled().usdcSettled).toBe(1.5);
    const t = mainnetSettledToTesters();
    expect(t.usdcSettled).toBe(0.5);
    expect(t.people).toBe(1);
  });

  it("sandbox campaigns' settlements never reach the ledger", () => {
    seedCampaign("sand", 2345, true);
    seedPaid("sand", TESTER, "0xtx1", 500_000);
    expect(settledLedger()).toHaveLength(0);
  });

  it("prices by the settled amount, not any reward lookup — the $0.10 payout stays $0.10", () => {
    seedCampaign("m1", 2345); // headline reward 500_000
    seedPaid("m1", TESTER, "0xtx1", 100_000);
    expect(mainnetSettled().usdcSettled).toBe(0.1);
  });
});

describe("every rail that actually paid counts — the rails file's intents, on the real db", () => {
  /** Absorbed from tester-supply-rails.test.ts (2026-09-01), which mocked listSubmissions —
   *  a mock the ledger no longer reads. Same intents, real rows: the Starknet rail was once
   *  erased by a `chainId === 2345` filter, and these keep every mainnet rail counted. */
  it("a Starknet settlement counts beside a GOAT one", () => {
    seedCampaign("goat", 2345);
    seedCampaign("stark", 900_001);
    seedPaid("goat", TESTER, "0xtx1", 500_000);
    seedPaid("stark", TESTER2, "0xtx2", 500_000, "autopay_settled");
    const t = mainnetSettledToTesters();
    expect(t.people).toBe(2);
    expect(t.payouts).toBe(2);
    expect(t.usdcSettled).toBe(1);
  });

  it("sandboxed campaigns never reach the launch page's numbers either", () => {
    seedCampaign("real", 2345);
    seedCampaign("sand", 2345, true);
    seedPaid("real", TESTER, "0xtx1", 500_000);
    seedPaid("sand", TESTER2, "0xtx2", 500_000);
    expect(getTesterSupply().missionsPaid).toBe(1);
  });
});

describe("the surfaces agree because they read the same rows", () => {
  it("the launch page's money numbers ARE the ledger's tester scope", () => {
    seedCampaign("m1", 2345);
    seedCampaign("t1", 59902);
    seedPaid("m1", TESTER, "0xtx1", 500_000);
    seedPaid("m1", TESTER2, "0xtx2", 4_740_000);
    seedPaid("m1", OPERATOR, "0xtx3", 1_000_000);
    seedPaid("t1", TESTER, "0xtx4", 500_000);
    const supply = getTesterSupply();
    const t = mainnetSettledToTesters();
    expect(supply.usdcSettled).toBe(t.usdcSettled);
    expect(supply.missionsPaid).toBe(t.payouts);
    expect(supply.testersPaid).toBe(t.people);
    expect(supply.usdcSettled).toBe(5.24);
    expect(supply.testersPaid).toBe(2);
  });
});
