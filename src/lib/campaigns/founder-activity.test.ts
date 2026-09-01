import { beforeEach, describe, expect, it, vi } from "vitest";

const loadCampaignActivity = vi.fn();
vi.mock("./load-activity", () => ({
  loadCampaignActivity: (...a: unknown[]) => loadCampaignActivity(...(a as [string, number])),
}));

import { loadFounderDesk } from "./founder-activity";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { createCampaign } from "@/lib/db/campaigns";
import { eq } from "drizzle-orm";

const F = "0x00000000000000000000000000000000000000f1";
const OTHER = "0x00000000000000000000000000000000000000f2";

const seed = (id: string, poster: string, sandbox = false) => {
  // The REAL creator, so the fixture can never disagree with the schema's own defaults.
  const c = createCampaign({
    title: `Campaign ${id}`,
    rewardAmount: 500_000,
    vaultAddress: "0x0000000000000000000000000000000000000001",
    posterWallet: poster,
    autonomy: "manual",
    sandbox,
    chainId: 2345,
  } as never);
  // deterministic ids for the assertions
  db.update(campaigns).set({ id }).where(eq(campaigns.id, c.id)).run();
  return id;
};

beforeEach(() => {
  db.delete(campaigns).run();
  loadCampaignActivity.mockReset();
  loadCampaignActivity.mockReturnValue({ activity: [], lastCheckedAt: null, pending: false });
});

describe("the founder's desk", () => {
  it("aggregates ONLY the founder's campaigns, never a stranger's", () => {
    seed("c1", F); seed("c2", OTHER);
    loadFounderDesk(F);
    expect(loadCampaignActivity).toHaveBeenCalledWith("c1", expect.any(Number));
    expect(loadCampaignActivity).not.toHaveBeenCalledWith("c2", expect.any(Number));
  });

  it("sandbox campaigns never reach the desk", () => {
    seed("real", F); seed("sand", F, true);
    loadFounderDesk(F);
    expect(loadCampaignActivity).not.toHaveBeenCalledWith("sand", expect.any(Number));
  });

  it("merges newest-first across campaigns, each row naming its campaign", () => {
    seed("c1", F); seed("c3", F);
    loadCampaignActivity.mockImplementation((id: string) => ({
      activity: [{ id: `${id}-e`, kind: "paid", at: id === "c1" ? 100 : 200, amountBase: 500_000, wallet: "0xw", txHash: "0xt", confidencePct: null, reasonClass: null }],
      lastCheckedAt: id === "c1" ? 100 : 200,
      pending: false,
    }));
    const desk = loadFounderDesk(F);
    expect(desk.events.map((e) => e.campaignId)).toEqual(["c3", "c1"]);
    expect(desk.events[0].campaignTitle).toBe("Campaign c3");
    expect(desk.lastWorkedAt).toBe(200);
  });

  it("chain-agnostic ownership: the felt founder finds their desk in either spelling", () => {
    seed("cs", "0x4f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434");
    loadFounderDesk("0x04F1f6530F84e4A1DB7fa35bAFc313174A2482A54c775C4321487Eb0fE91f434");
    expect(loadCampaignActivity).toHaveBeenCalledWith("cs", expect.any(Number));
  });
});
