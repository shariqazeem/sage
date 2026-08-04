import { eq } from "drizzle-orm";
import { describe, it, expect } from "vitest";
import { marketplace } from "./marketplace";
import {
  createCampaign,
  createSubmission,
  setCampaignStatus,
  createMission,
} from "@/lib/db/campaigns";
import { db } from "@/lib/db";
import { missions, submissions } from "@/lib/db/schema";

/**
 * THE MARKETPLACE MUST ONLY LIST WORK THAT CAN ACTUALLY PAY.
 *
 * A tester who does a mission that cannot settle has been made to work for nothing, and they find
 * out only after submitting. That is the same class of untruth as a stopped campaign showing
 * "verifying" forever — so every exclusion here is a payability rule, not a cosmetic filter:
 * a draft has no vault, a stopped campaign's vault is revoked, the sandbox can never settle by
 * construction, a closed mission was retired, and a full mission has no slot left to pay for.
 */

let seq = 0;
const wallet = () => `0x${(++seq).toString(16).padStart(40, "0")}`;

function campaign(over: { status?: string; sandbox?: boolean; title?: string } = {}) {
  const c = createCampaign({
    title: over.title ?? `camp-${++seq}`,
    rewardAmount: 1_000_000,
    vaultAddress: "0x0000000000000000000000000000000000000001",
    posterWallet: "0x0000000000000000000000000000000000000002",
    autonomy: "autopilot",
    sandbox: over.sandbox ?? false,
  });
  setCampaignStatus(c.id, (over.status ?? "live") as never);
  return c;
}

let mseq = 0;
function mission(
  campaignId: string,
  over: { rewardAmount?: number; maxCompletions?: number; status?: string } = {},
) {
  const key = `m${++mseq}`;
  const hash = `0x${mseq.toString(16).padStart(64, "0")}`;
  createMission({
    campaignId,
    missionKey: key,
    missionIdHash: hash,
    title: `Mission ${key}`,
    descriptionMd: "",
    objective: "do the thing",
    instructions: "",
    targetSurface: "https://example.com",
    criteria: ["it works"],
    evidenceList: ["say what you saw"],
    rewardAmount: over.rewardAmount ?? 500_000,
    maxCompletions: over.maxCompletions ?? 2,
    verifiabilityClass: "observation-based",
    displayOrder: mseq,
  });
  if (over.status) {
    db.update(missions)
      .set({ status: over.status as "draft" | "active" | "paused" | "closed" })
      .where(eq(missions.missionKey, key))
      .run();
  }
  return { key, hash };
}

/** Mark N completions of a mission as paid — the only thing that consumes a slot. */
function pay(campaignId: string, missionIdHash: string, n: number) {
  for (let i = 0; i < n; i++) {
    const r = createSubmission({ campaignId, wallet: wallet() });
    if (!r.ok) throw new Error(r.error);
    db.update(submissions)
      .set({ status: "paid", missionIdHash })
      .where(eq(submissions.id, r.submission.id))
      .run();
  }
}

const ids = () => marketplace().campaigns.map((c) => c.id);

describe("only payable work is listed", () => {
  it("lists a live campaign with an open mission", () => {
    const c = campaign();
    mission(c.id);
    expect(ids()).toContain(c.id);
  });

  it.each(["draft", "paused", "completed", "cancelled", "closed"])(
    "hides a %s campaign — its vault cannot pay",
    (status) => {
      const c = campaign({ status });
      mission(c.id);
      expect(ids()).not.toContain(c.id);
    },
  );

  it("hides the sandbox campaign, which can never settle by construction", () => {
    const c = campaign({ sandbox: true });
    mission(c.id);
    expect(ids()).not.toContain(c.id);
  });

  it("hides a closed mission, and the campaign too when it was the only one", () => {
    const c = campaign();
    mission(c.id, { status: "closed" });
    expect(ids()).not.toContain(c.id);
  });

  it("hides a mission whose every slot is already paid", () => {
    const c = campaign();
    const m = mission(c.id, { maxCompletions: 2 });
    pay(c.id, m.hash, 2);
    expect(ids()).not.toContain(c.id);
  });

  it("still lists it while one slot remains, with the count correct", () => {
    const c = campaign();
    const m = mission(c.id, { maxCompletions: 3 });
    pay(c.id, m.hash, 2);
    const found = marketplace().campaigns.find((x) => x.id === c.id)!;
    expect(found.openSlots).toBe(1);
    expect(found.missions[0]!.paid).toBe(2);
    expect(found.missions[0]!.remainingSlots).toBe(1);
  });

  it("keeps a campaign whose OTHER mission is still open", () => {
    const c = campaign();
    const full = mission(c.id, { maxCompletions: 1 });
    mission(c.id, { maxCompletions: 4 });
    pay(c.id, full.hash, 1);
    const found = marketplace().campaigns.find((x) => x.id === c.id)!;
    expect(found.openMissions).toBe(1);
    expect(found.openSlots).toBe(4);
  });
});

describe("the money it advertises is right", () => {
  it("reports rewards in dollars, not base units", () => {
    const c = campaign();
    mission(c.id, { rewardAmount: 250_000, maxCompletions: 2 }); // $0.25
    const found = marketplace().campaigns.find((x) => x.id === c.id)!;
    expect(found.missions[0]!.rewardUsd).toBe(0.25);
    expect(found.topRewardUsd).toBe(0.25);
  });

  it("totalOpenUsd counts only UNFILLED slots — never money already paid out", () => {
    const c = campaign();
    const m = mission(c.id, { rewardAmount: 1_000_000, maxCompletions: 5 }); // $1 x 5
    pay(c.id, m.hash, 3);
    const found = marketplace().campaigns.find((x) => x.id === c.id)!;
    expect(found.totalOpenUsd).toBe(2); // 2 slots left, not 5
  });

  it("headlines the LARGEST reward on offer and orders missions by it", () => {
    const c = campaign();
    mission(c.id, { rewardAmount: 100_000 });
    mission(c.id, { rewardAmount: 900_000 });
    const found = marketplace().campaigns.find((x) => x.id === c.id)!;
    expect(found.topRewardUsd).toBe(0.9);
    expect(found.missions[0]!.rewardUsd).toBe(0.9);
  });

  it("totals across campaigns are the sum of what it listed", () => {
    const before = marketplace();
    const c = campaign();
    mission(c.id, { rewardAmount: 500_000, maxCompletions: 2 }); // +$1.00, +2 slots
    const after = marketplace();
    expect(after.totals.slots).toBe(before.totals.slots + 2);
    expect(after.totals.usd).toBeCloseTo(before.totals.usd + 1, 6);
    expect(after.totals.campaigns).toBe(after.campaigns.length);
  });
});

describe("ordering and shape", () => {
  it("puts the biggest single reward first", () => {
    const small = campaign();
    mission(small.id, { rewardAmount: 100_000 });
    const big = campaign();
    mission(big.id, { rewardAmount: 5_000_000 });
    const order = ids();
    expect(order.indexOf(big.id)).toBeLessThan(order.indexOf(small.id));
  });

  it("gives every campaign a board path a tester can actually open", () => {
    const c = campaign();
    mission(c.id);
    const found = marketplace().campaigns.find((x) => x.id === c.id)!;
    expect(found.boardPath).toBe(`/c/${c.id}`);
  });

  it("an empty marketplace reports zeroes rather than throwing", () => {
    // Every seeded campaign is terminal → nothing listable.
    for (const c of marketplace().campaigns) setCampaignStatus(c.id, "completed" as never);
    const v = marketplace();
    expect(v.campaigns).toEqual([]);
    expect(v.totals).toEqual({ campaigns: 0, missions: 0, slots: 0, usd: 0 });
  });
});
