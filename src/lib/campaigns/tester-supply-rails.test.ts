import { describe, expect, it, vi } from "vitest";

/**
 * PUBLIC PROOF HAS TO COUNT EVERY RAIL THAT ACTUALLY PAID.
 *
 * This filtered on `chainId === 2345`. The moment a second rail started paying people, its payouts
 * vanished from every number a stranger reads before deciding whether Sage is real — testers paid,
 * USDC settled, missions paid, time to payout. REPORTED: two Starknet payouts had settled and the
 * marketplace, landing and plan page all behaved as though the rail did not exist.
 */

const campaigns = [
  { id: "goat", chainId: 2345, sandbox: false, rewardAmount: 500_000 },
  { id: "starknet", chainId: 900_001, sandbox: false, rewardAmount: 500_000 },
  { id: "testnet", chainId: 59_902, sandbox: false, rewardAmount: 500_000 },
  { id: "sandboxed", chainId: 2345, sandbox: true, rewardAmount: 500_000 },
];
type Sub = { campaignId: string; status: string; wallet: string; createdAt: number; decidedAt: number };
/** campaignId matters: the settled total is looked up by it, so omitting it prices everything at 0. */
const sub = (campaignId: string, wallet: string): Sub => ({
  campaignId, status: "paid", wallet, createdAt: 100, decidedAt: 200,
});
const subs: Record<string, Sub[]> = {
  goat: [sub("goat", "0xaaa")],
  starknet: [sub("starknet", "0xbbb")],
  testnet: [sub("testnet", "0xccc")],
  sandboxed: [sub("sandboxed", "0xddd")],
};

vi.mock("@/lib/db/campaigns", () => ({
  listCampaigns: () => campaigns,
  listSubmissions: (id: string) => subs[id] ?? [],
}));

import { getTesterSupply } from "./tester-supply";

describe("which payouts count as proof", () => {
  const s = getTesterSupply();

  it("counts a Starknet payout — the rail that was being erased", () => {
    // GOAT + Starknet, not GOAT alone.
    expect(s.testersPaid).toBe(2);
    expect(s.missionsPaid).toBe(2);
    expect(s.usdcSettled).toBe(1);
  });

  it("still excludes testnet money, which is not proof of anything", () => {
    expect(s.testersPaid).not.toBe(3);
  });

  it("still excludes sandboxed campaigns", () => {
    expect(s.missionsPaid).toBe(2);
  });
});
