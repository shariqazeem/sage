import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, events, submissions } from "@/lib/db/schema";
import { createCampaign, createSubmission, recordEvent } from "@/lib/db/campaigns";
import { GET } from "./route";

/**
 * GET /api/ledger (7 Nov 2026): the list a stranger recounts from. Every payout with the vault it left,
 * who decided it, and Sage's own wallets spelled exactly as they are on chain.
 */

const VAULT = "0x000000000000000000000000000000000000beef";

const seed = (wallet: string, tx: string, agent: boolean) => {
  const r = createSubmission({ campaignId: "j1", wallet, evidenceUrl: `https://x.example/${tx}` });
  if (!r.ok) throw new Error(r.error);
  db.update(submissions).set({ status: "paid", payoutTx: tx }).where(eq(submissions.id, r.submission.id)).run();
  recordEvent({ campaignId: "j1", submissionId: r.submission.id, kind: "settled", txHash: tx, amount: 500_000 });
  if (agent) recordEvent({ campaignId: "j1", submissionId: r.submission.id, kind: "autopay_settled", txHash: tx, amount: 500_000 });
};

beforeEach(() => {
  db.delete(events).run();
  db.delete(submissions).run();
  db.delete(campaigns).run();
  const c = createCampaign({ title: "J", rewardAmount: 500_000, vaultAddress: VAULT, posterWallet: "0x00000000000000000000000000000000000000f1", autonomy: "manual", sandbox: false, chainId: 1088 } as never);
  db.update(campaigns).set({ id: "j1" }).where(eq(campaigns.id, c.id)).run();
});

describe("GET /api/ledger", () => {
  it("lists every payout with its vault and decider, and the numbers over the same rows", async () => {
    seed("0x00000000000000000000000000000000000000a1", "0xtx1", true);
    seed("0xdf70f6e8e656e5bb714ff0e8ca176d76f26890e3", "0xtx2", false);
    const body = await GET().json();
    expect(body.payouts).toHaveLength(2);
    const person = body.payouts.find((p: { txHash: string }) => p.txHash === "0xtx1");
    expect(person).toMatchObject({ chainId: 1088, network: "metis-andromeda", vault: VAULT, decidedBy: "agent", ownWallet: false, amountBase: 500_000, job: "j1" });
    expect(person.receipt).toMatch(/\/proof\/0xtx1$/);
    expect(body.payouts.find((p: { txHash: string }) => p.txHash === "0xtx2")).toMatchObject({ decidedBy: "person", ownWallet: true });
    expect(body.numbers).toMatchObject({ payouts: 1, byAgent: 1, people: 1, jobs: 1, ownWallets: { payouts: 1 } });
  });

  it("publishes Sage's own wallets as they are spelled on chain", async () => {
    const body = await GET().json();
    expect(body.ownWallets).toContain("0x0def3d4124d0cd1708aeffe6c1bc8182342a44d6");
    for (const w of body.ownWallets as string[]) expect(w).toMatch(/^0x([0-9a-f]{40}|[0-9a-f]{50,64})$/);
  });
});
