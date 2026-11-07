import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentWallets, campaigns, events, missions, programmeRounds, programmes, submissions, walletLinks } from "@/lib/db/schema";
import { createCampaign, createSubmission, recordEvent } from "@/lib/db/campaigns";
import { mainnetSettled } from "@/lib/campaigns/settled-ledger";
import { linkWallets } from "@/lib/campaigns/wallet-links";
import { marketplace } from "@/lib/campaigns/marketplace";
import { sageNumbers } from "./sage-numbers";

/**
 * THE NUMBERS THE FOUNDER WILL QUOTE (7 Nov 2026): every word of "N payouts by the agent, to M people,
 * across J jobs" counted one way, on real rows, and equal to what the job board already publishes.
 */

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000a2";
const C = "0x00000000000000000000000000000000000000a3";
const FOUNDER_OWN = "0xdf70f6e8e656e5bb714ff0e8ca176d76f26890e3";
const TEAM = "0x00000000000000000000000000000000000000f1";
const TEAM_ACCOUNT = "0x00000000000000000000000000000000000000e1";
const NOW = 1_794_000_000;

const seedCampaign = (id: string, opts: { chainId?: number; poster?: string; kind?: "testing" | "grant" | "gig" } = {}) => {
  const c = createCampaign({
    title: `C ${id}`,
    rewardAmount: 500_000,
    vaultAddress: "0x0000000000000000000000000000000000000001",
    posterWallet: opts.poster ?? TEAM,
    autonomy: "manual",
    sandbox: false,
    chainId: opts.chainId ?? 1088,
  } as never);
  db.update(campaigns).set({ id, kind: opts.kind ?? "gig" }).where(eq(campaigns.id, c.id)).run();
  return id;
};

let n = 0;
const pay = (campaignId: string, wallet: string, opts: { agent?: boolean; amount?: number; mission?: string } = {}) => {
  const tx = `0xtx${++n}`;
  const r = createSubmission({ campaignId, wallet, evidenceUrl: `https://x.example/${tx}`, missionIdHash: opts.mission ?? null });
  if (!r.ok) throw new Error(r.error);
  db.update(submissions).set({ status: "paid", payoutTx: tx }).where(eq(submissions.id, r.submission.id)).run();
  const amount = opts.amount ?? 500_000;
  recordEvent({ campaignId, submissionId: r.submission.id, kind: "settled", txHash: tx, amount });
  if (opts.agent) recordEvent({ campaignId, submissionId: r.submission.id, kind: "autopay_settled", txHash: tx, amount });
  return tx;
};

const mission = (campaignId: string, hash: string, max = 1) =>
  db
    .insert(missions)
    .values({ id: `m-${hash}`, campaignId, missionKey: hash, missionIdHash: hash, title: hash, rewardAmount: 500_000, maxCompletions: max, createdAt: NOW, updatedAt: NOW })
    .run();

beforeEach(() => {
  for (const t of [events, submissions, missions, programmeRounds, programmes, agentWallets, walletLinks, campaigns]) db.delete(t).run();
  n = 0;
});

describe("sageNumbers", () => {
  it("counts payouts to people, the agent's share, people, repeat people and jobs", () => {
    seedCampaign("j1");
    seedCampaign("j2");
    // the same person, paid for two different missions of one job
    pay("j1", A, { agent: true, mission: "0xr1" });
    pay("j1", A, { agent: true, mission: "0xr2" });
    pay("j1", B);
    pay("j2", C, { agent: true });
    const x = sageNumbers();
    expect(x.payouts).toBe(4);
    expect(x.byAgent).toBe(3);
    expect(x.paidUsd).toBe(2);
    expect(x.people).toBe(3);
    expect(x.paidAgain).toBe(1);
    expect(x.jobs).toBe(2);
    expect(x.jobsByAgent).toBe(2);
  });

  it("Sage's own wallets are counted apart, so people plus own is every settlement", () => {
    seedCampaign("j1");
    pay("j1", A, { agent: true });
    pay("j1", FOUNDER_OWN, { agent: true });
    const x = sageNumbers();
    expect(x.payouts).toBe(1);
    expect(x.ownWallets.payouts).toBe(1);
    expect(x.total.payouts).toBe(mainnetSettled().payouts);
    expect(x.total.paidUsd).toBe(mainnetSettled().usdcSettled);
  });

  it("wallets one person controls count once", () => {
    seedCampaign("j1");
    pay("j1", A, { agent: true });
    pay("j1", B, { agent: true });
    linkWallets(A, B, NOW);
    const x = sageNumbers();
    expect(x.people).toBe(1);
    expect(x.paidAgain).toBe(1);
  });

  it("test networks never count", () => {
    seedCampaign("t1", { chainId: 59902 });
    pay("t1", A, { agent: true });
    expect(sageNumbers().payouts).toBe(0);
  });

  it("a team is the founder behind a Sage account, and Sage itself is never a team", () => {
    seedCampaign("j1", { poster: TEAM_ACCOUNT });
    seedCampaign("j2", { poster: TEAM });
    seedCampaign("own", { poster: FOUNDER_OWN });
    db.insert(agentWallets)
      .values({ chatId: `web:${TEAM}`, founderAddress: TEAM, privyWalletId: "w1", privyWalletAddress: TEAM_ACCOUNT, policyId: "p1", perCampaignCapBase: 50_000_000, chainId: 1088, createdAt: NOW, updatedAt: NOW })
      .run();
    pay("j1", A, { agent: true });
    pay("j2", B, { agent: true });
    pay("own", C, { agent: true });
    const x = sageNumbers();
    expect(x.jobs).toBe(3);
    expect(x.teams).toBe(1);
  });

  it("a grant is completed when every milestone has been paid to a person", () => {
    seedCampaign("g1", { kind: "grant" });
    seedCampaign("g2", { kind: "grant" });
    mission("g1", "0xm1");
    mission("g1", "0xm2");
    mission("g2", "0xm3");
    mission("g2", "0xm4");
    pay("g1", A, { mission: "0xm1", agent: true });
    pay("g1", A, { mission: "0xm2", agent: true });
    pay("g2", B, { mission: "0xm3", agent: true });
    // the second milestone of g2 was paid to the founder's own wallet: not a person paid
    pay("g2", FOUNDER_OWN, { mission: "0xm4", agent: true });
    expect(sageNumbers().grants).toEqual({ completed: 1, paying: 2 });
  });

  it("a round counts once it paid a person", () => {
    seedCampaign("r1");
    seedCampaign("r2");
    db.insert(programmes)
      .values({ id: "prg1", founderWallet: TEAM, chainId: 1088, title: "Weekly", spec: {} as never, roundBudgetBase: 1_000_000, everyDays: 7, roundsTotal: 4, nextRoundAt: NOW, status: "active", createdAt: NOW, updatedAt: NOW } as never)
      .run();
    db.insert(programmeRounds)
      .values([
        { programmeId: "prg1", round: 1, status: "live", campaignId: "r1", createdAt: NOW, updatedAt: NOW },
        { programmeId: "prg1", round: 2, status: "live", campaignId: "r2", createdAt: NOW, updatedAt: NOW },
      ] as never)
      .run();
    pay("r1", A, { agent: true });
    expect(sageNumbers().rounds).toBe(1);
  });

  it("says exactly what the job board says about payouts, money and people", () => {
    seedCampaign("j1");
    pay("j1", A, { agent: true });
    pay("j1", B);
    pay("j1", FOUNDER_OWN, { agent: true });
    linkWallets(A, C, NOW);
    pay("j1", C, { agent: true });
    const board = marketplace().paidToDate;
    const x = sageNumbers();
    expect(x.payouts).toBe(board.count);
    expect(x.paidUsd).toBe(board.usd);
    expect(x.people).toBe(board.people);
  });
});
