import { eq } from "drizzle-orm";
import { describe, it, expect } from "vitest";
import { marketplace } from "./marketplace";
import {
  createCampaign,
  createSubmission,
  setCampaignStatus,
  createMission,
  recordEvent,
} from "@/lib/db/campaigns";
import { db } from "@/lib/db";
import { campaigns, missions, submissions } from "@/lib/db/schema";

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

function campaign(
  over: { status?: string; sandbox?: boolean; title?: string; chainId?: number; corpusSources?: number } = {},
) {
  const c = createCampaign({
    title: over.title ?? `camp-${++seq}`,
    rewardAmount: 1_000_000,
    vaultAddress: "0x0000000000000000000000000000000000000001",
    posterWallet: "0x0000000000000000000000000000000000000002",
    autonomy: "autopilot",
    sandbox: over.sandbox ?? false,
    // GOAT mainnet. The column default is the testnet, and a testnet campaign is deliberately not
    // listable, so a fixture that took the default would be testing the exclusion by accident.
    chainId: over.chainId ?? 2345,
  });
  setCampaignStatus(c.id, (over.status ?? "live") as never);
  // A CORPUS BY DEFAULT, because the default mission below is observation-based and observation work
  // is only payable when there is something pinned to judge it against. Leaving it at zero made
  // every fixture here describe work that cannot settle — which is precisely what these tests exist
  // to exclude, so they would have been asserting the exclusion by accident.
  db.update(campaigns)
    .set({ privateCorpusSources: over.corpusSources ?? 9 })
    .where(eq(campaigns.id, c.id))
    .run();
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

describe("the tester-facing rows — one per mission, not per campaign", () => {
  it("flattens every open mission into its own row, carrying its campaign", () => {
    const c = campaign({ title: "Acme test" });
    mission(c.id, { rewardAmount: 300_000 });
    mission(c.id, { rewardAmount: 700_000 });
    const rows = marketplace().rows.filter((r) => r.campaignId === c.id);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.campaignTitle).toBe("Acme test");
      expect(r.boardPath).toBe(`/c/${c.id}`);
      expect(r.key).toContain(c.id); // stable react key, unique per mission
    }
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it("is sorted by reward so the default view answers 'what pays most'", () => {
    const rows = marketplace().rows;
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.rewardUsd).toBeGreaterThanOrEqual(rows[i]!.rewardUsd);
    }
  });

  it("shows the product host a tester would recognise, not the raw surface", () => {
    const c = campaign();
    mission(c.id);
    const r = marketplace().rows.find((x) => x.campaignId === c.id)!;
    expect(r.productHost).toBe("example.com"); // targetSurface is https://example.com
  });

  it("survives a mission whose targetSurface is not a usable URL", () => {
    // A row must still render — a bad surface is a mission-authoring gap, not a reason to 500.
    expect(() => marketplace().rows).not.toThrow();
  });

  it("never lists a row for work the campaign view already excluded", () => {
    const v = marketplace();
    const listed = new Set(v.campaigns.map((c) => c.id));
    for (const r of v.rows) expect(listed.has(r.campaignId)).toBe(true);
    // and the counts agree, so the two views can never disagree about what is open
    expect(v.rows.length).toBe(v.totals.missions);
    expect(v.rows.reduce((s, r) => s + r.remainingSlots, 0)).toBe(v.totals.slots);
  });
});

describe("effort is a coarse label, never a promise", () => {
  it("is one of the three known buckets", () => {
    for (const r of marketplace().rows) {
      expect(["quick", "standard", "deep"]).toContain(r.effort);
    }
  });

  it("grows with what the mission actually asks for", () => {
    const c = campaign();
    mission(c.id);
    const r = marketplace().rows.find((x) => x.campaignId === c.id)!;
    // 1 criterion + 1 evidence requirement = the smallest possible ask
    expect(r.effort).toBe("quick");
  });
});

describe("payout proof is read from settled transactions, never asserted", () => {
  it("an unproven marketplace reports zero rather than inventing a figure", () => {
    const v = marketplace();
    // Every payout must carry a hash; a "paid" row without one is a claim, not proof.
    for (const p of v.recentPayouts) expect(p.txHash).toBeTruthy();
    expect(v.paidToDate.count).toBe(v.recentPayouts.length <= 8 ? v.paidToDate.count : 0);
    expect(v.paidToDate.usd).toBeGreaterThanOrEqual(0);
  });

  it("counts a settled payout and reports its real reward, not the campaign headline", () => {
    const c = campaign();
    const m = mission(c.id, { rewardAmount: 400_000, maxCompletions: 3 }); // $0.40
    const r = createSubmission({ campaignId: c.id, wallet: wallet() });
    if (!r.ok) throw new Error(r.error);
    db.update(submissions)
      .set({ status: "paid", missionIdHash: m.hash, payoutTx: "0xdeadbeef" })
      .where(eq(submissions.id, r.submission.id))
      .run();
    // production always journals the settlement (the EVM flow internally, the dispatcher for
    // Starknet) — the marketplace now prices from that ledger row, so the fixture writes it too.
    recordEvent({ campaignId: c.id, submissionId: r.submission.id, kind: "settled", txHash: "0xdeadbeef", amount: 400_000 });

    const v = marketplace();
    const p = v.recentPayouts.find((x) => x.txHash === "0xdeadbeef");
    expect(p).toBeTruthy();
    expect(p!.usd).toBe(0.4);
    expect(p!.productHost).toBe("example.com");
    expect(v.paidToDate.count).toBeGreaterThanOrEqual(1);
  });

  it("a paid row with NO transaction hash is not counted as proof", () => {
    const before = marketplace().paidToDate.count;
    const c = campaign();
    const m = mission(c.id);
    const r = createSubmission({ campaignId: c.id, wallet: wallet() });
    if (!r.ok) throw new Error(r.error);
    // paid, but never settled on-chain
    db.update(submissions)
      .set({ status: "paid", missionIdHash: m.hash, payoutTx: null })
      .where(eq(submissions.id, r.submission.id))
      .run();
    expect(marketplace().paidToDate.count).toBe(before);
  });

  it("shows the most recent payouts first, capped", () => {
    const v = marketplace();
    expect(v.recentPayouts.length).toBeLessThanOrEqual(8);
    for (let i = 1; i < v.recentPayouts.length; i++) {
      expect(v.recentPayouts[i - 1]!.at).toBeGreaterThanOrEqual(v.recentPayouts[i]!.at);
    }
  });
});

describe("a payout the ledger priced needs no mission to be proof", () => {
  /** REVERSED (2026-09-01): "unpriceable" existed because the amount was a mission lookup — a
   *  ghost mission meant no price, and a $0.00 line was worse than no line. The ledger prices
   *  by what the vault actually released, so a settled row whose mission no longer resolves is
   *  still real money with a real amount — it shows without a product host, never as $0.00. */
  it("shows a settled row whose mission no longer resolves, priced by the ledger, host unknown", () => {
    const c = campaign();
    const r = createSubmission({ campaignId: c.id, wallet: wallet() });
    if (!r.ok) throw new Error(r.error);
    db.update(submissions)
      .set({ status: "paid", missionIdHash: "0xghost", payoutTx: "0xunpriceable" })
      .where(eq(submissions.id, r.submission.id))
      .run();
    recordEvent({ campaignId: c.id, submissionId: r.submission.id, kind: "settled", txHash: "0xunpriceable", amount: 250_000 });

    const v = marketplace();
    const p = v.recentPayouts.find((x) => x.txHash === "0xunpriceable");
    expect(p).toBeTruthy();
    expect(p!.usd).toBe(0.25);
    expect(p!.productHost).toBeNull();
    // still never a $0.00 line
    for (const x of v.recentPayouts) expect(x.usd).toBeGreaterThan(0);
  });
});

describe("testnet work is not paid work", () => {
  it("a testnet campaign is never listed, however healthy it looks", () => {
    const c = campaign({ chainId: 59902 });
    mission(c.id, { rewardAmount: 5_000_000, maxCompletions: 20 });
    expect(ids()).not.toContain(c.id);
    expect(marketplace().rows.find((r) => r.campaignId === c.id)).toBeUndefined();
  });

  it("its money never reaches the headline totals", () => {
    const before = marketplace().totals;
    const c = campaign({ chainId: 59902 });
    mission(c.id, { rewardAmount: 9_000_000, maxCompletions: 9 });
    expect(marketplace().totals).toEqual(before);
  });

  it("the mainnet equivalent IS listed, so the exclusion is about the chain and nothing else", () => {
    const c = campaign({ chainId: 2345 });
    mission(c.id, { rewardAmount: 5_000_000, maxCompletions: 20 });
    expect(ids()).toContain(c.id);
  });
});


/**
 * OBSERVATION WORK WITH NOTHING TO JUDGE IT AGAINST CANNOT BE PAID.
 *
 * `observationBar` hard-fails `thin_corpus` below OBS_BAR.minKeySources, so every submission against
 * such a mission is held — not sometimes, always.
 *
 * MEASURED live: launch-kyvernlabs-com-63rjdf sat on this board with three observation missions,
 * eleven open slots and a corpus of zero, while the board told testers "Sage assesses your account
 * against what it saw itself and pays automatically when it clears". A stranger arriving from a
 * founder DM would have done real work and waited forever.
 */
describe("a mission with no corpus to judge it against is not advertised", () => {
  it("hides observation missions when the campaign has no pinned corpus", () => {
    const c = campaign({ corpusSources: 0 });
    mission(c.id);
    expect(ids()).not.toContain(c.id);
  });

  it("hides them when the corpus is below the eligibility bar, not just at zero", () => {
    const c = campaign({ corpusSources: 4 }); // OBS_BAR.minKeySources is 5
    mission(c.id);
    expect(ids()).not.toContain(c.id);
  });

  it("lists them the moment the corpus clears the bar", () => {
    const c = campaign({ corpusSources: 5 });
    mission(c.id);
    expect(ids()).toContain(c.id);
  });

  it("still lists url-verifiable work, which needs no corpus to judge", () => {
    const c = campaign({ corpusSources: 0 });
    const m = mission(c.id);
    db.update(missions)
      .set({ verifiabilityClass: "url-verifiable" })
      .where(eq(missions.missionKey, m.key))
      .run();
    expect(ids()).toContain(c.id);
  });

  it("drops only the unjudgeable mission, keeping the campaign's payable one", () => {
    const c = campaign({ corpusSources: 0 });
    mission(c.id); // observation-based, unjudgeable here
    const url = mission(c.id);
    db.update(missions)
      .set({ verifiabilityClass: "url-verifiable" })
      .where(eq(missions.missionKey, url.key))
      .run();
    const listed = marketplace().campaigns.find((x) => x.id === c.id);
    expect(listed).toBeDefined();
    expect(listed!.missions).toHaveLength(1);
    expect(listed!.missions[0]!.verifiabilityClass).toBe("url-verifiable");
  });
});

describe("WORK PROOF — allowlisted campaigns are invite-only, never advertised", () => {
  it("a campaign with a recipient allowlist is excluded; clearing it re-lists", () => {
    const c = campaign({ title: "grant-invite-only" });
    mission(c.id, {});
    db.update(campaigns)
      .set({ allowlist: ["0x00000000000000000000000000000000000000aa"] })
      .where(eq(campaigns.id, c.id))
      .run();
    expect(marketplace().campaigns.some((x) => x.id === c.id)).toBe(false);

    db.update(campaigns).set({ allowlist: null }).where(eq(campaigns.id, c.id)).run();
    expect(marketplace().campaigns.some((x) => x.id === c.id)).toBe(true);
  });
});
