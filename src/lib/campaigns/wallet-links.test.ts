import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { campaigns, events, submissions, walletLinks } from "@/lib/db/schema";
import { createCampaign, createSubmission, recordEvent } from "@/lib/db/campaigns";
import { eq } from "drizzle-orm";
import { buildLinkedRecord, linkWallets, linkedWalletsOf } from "./wallet-links";

const EVM = "0x00000000000000000000000000000000000000a1";
const SN = "0x05db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";
const OTHER = "0x00000000000000000000000000000000000000c3";

const campaign = (poster: string, chainId: number) =>
  createCampaign({ title: "c", rewardAmount: 500_000, vaultAddress: "0x0000000000000000000000000000000000000001", posterWallet: poster, autonomy: "autopilot", sandbox: false, chainId } as never);
const paid = (campaignId: string, wallet: string, tx: string, amount = 500_000) => {
  const r = createSubmission({ campaignId, wallet, evidenceUrl: `https://x.example/${tx}` });
  if (!r.ok) throw new Error(r.error);
  db.update(submissions).set({ status: "paid", payoutTx: tx, decidedAt: 1_788_000_000 }).where(eq(submissions.id, r.submission.id)).run();
  recordEvent({ campaignId, submissionId: r.submission.id, kind: "settled", txHash: tx, amount });
  return r.submission.id;
};

beforeEach(() => { db.delete(walletLinks).run(); db.delete(events).run(); db.delete(submissions).run(); db.delete(campaigns).run(); });

describe("one business, many rails", () => {
  it("links once, in canonical order, and never links a wallet to itself", () => {
    expect(linkWallets(EVM, SN)).toEqual({ linked: true });
    expect(linkWallets(SN, EVM)).toEqual({ linked: false }); // already linked, either direction
    expect(linkWallets(EVM, EVM)).toEqual({ linked: false });
    expect(linkedWalletsOf(SN)).toEqual([EVM, SN].sort());
  });

  it("walks the closure — a third wallet linked to either side joins the business", () => {
    linkWallets(EVM, SN); linkWallets(SN, OTHER);
    expect(linkedWalletsOf(EVM)).toEqual([EVM, SN, OTHER].sort());
  });

  it("the combined record is the union of receipt-anchored entries with the formulas run over it", () => {
    const goat = campaign("0x00000000000000000000000000000000000000f1", 2345);
    const stark = campaign("0x00000000000000000000000000000000000000f2", 900_001);
    paid(goat.id, EVM, "0xtx1");
    paid(stark.id, SN, "0xtx2", 1_000_000);
    linkWallets(EVM, SN);
    const linked = buildLinkedRecord(EVM)!;
    expect(linked.wallets).toEqual([EVM, SN].sort());
    expect(linked.record.completions).toBe(2);
    expect(linked.record.totalUsd).toBeCloseTo(1.5, 6);
    expect(linked.record.distinctCampaigns).toBe(2);
    expect(linked.signals.distinctPayers).toBe(2); // two funders across two rails — one business
    expect(linked.signals.verifiedInflowUsd).toBeCloseTo(1.5, 6);
  });

  it("an unlinked wallet is a business of one — identical to its own record", () => {
    const goat = campaign("0x00000000000000000000000000000000000000f1", 2345);
    paid(goat.id, EVM, "0xtx1");
    const linked = buildLinkedRecord(EVM)!;
    expect(linked.wallets).toEqual([EVM]);
    expect(linked.record.completions).toBe(1);
  });
});
