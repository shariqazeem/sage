import { beforeEach, describe, expect, it } from "vitest";
import {
  closeMission,
  countPaidForMission,
  createCampaign,
  createMission,
  createSubmission,
  getDecisionBySubmission,
  getMissionByHash,
  getMissionByKey,
  getSubmission,
  getWalletMissionSubmission,
  insertDecision,
  listMissions,
  lockMissionPlan,
  recomputeMissionSpecDigest,
  reviseSubmission,
  updateMissionDraft,
  updateSubmission,
} from "./campaigns";
import { computeCampaignPlan, missionIdHash } from "@/lib/campaigns/mission-plan";
import type { Campaign } from "./schema";

/**
 * Mission lifecycle + the durable V2 tester rule (one wallet, one payout PER MISSION),
 * enforced by the DB unique index — never application-only. V1 campaign-level
 * submission semantics must remain unchanged.
 */

function seedCampaign(): { campaign: Campaign; cid: string } {
  const c = createCampaign({
    title: "V2",
    rewardAmount: 500_000,
    vaultAddress: `0x${"1".repeat(40)}`,
    posterWallet: `0x${"b".repeat(40)}`,
    chainId: 59902,
    vaultKind: "campaign_v2",
  });
  const plan = computeCampaignPlan(c.id, [
    { missionKey: "load", rewardBase: BigInt(500_000), maxCompletions: BigInt(2) },
    { missionKey: "signup", rewardBase: BigInt(1_000_000), maxCompletions: BigInt(3) },
  ]);
  return { campaign: { ...c, campaignIdHash: plan.campaignIdHash } as Campaign, cid: plan.campaignIdHash };
}

function draft(campaignId: string, key: string, order = 0) {
  return createMission({
    campaignId,
    missionKey: key,
    missionIdHash: missionIdHash(campaignId, key),
    title: `Mission ${key}`,
    objective: "Do the thing",
    instructions: "1. step\n2. step",
    targetSurface: "https://app.example.com",
    criteria: ["it works"],
    evidenceList: ["a recording"],
    rewardAmount: 500_000,
    maxCompletions: 2,
    status: "draft",
    displayOrder: order,
  });
}

beforeEach(() => {
  /* real in-memory db; ids are unique per seed */
});

describe("mission lifecycle", () => {
  it("create draft, list in order, resolve by key + hash", () => {
    const { campaign } = seedCampaign();
    draft(campaign.id, "load", 0);
    draft(campaign.id, "signup", 1);
    const list = listMissions(campaign.id);
    expect(list.map((m) => m.missionKey)).toEqual(["load", "signup"]);
    expect(getMissionByKey(campaign.id, "load")?.title).toBe("Mission load");
    expect(getMissionByHash(campaign.id, missionIdHash(campaign.id, "signup"))?.missionKey).toBe("signup");
  });

  it("lockMissionPlan freezes the spec digest, sets active + lockedAt", () => {
    const { campaign, cid } = seedCampaign();
    const m = draft(campaign.id, "load");
    expect(m.status).toBe("draft");
    expect(m.specDigest).toBeNull();
    const locked = lockMissionPlan(campaign.id, cid);
    expect(locked).toBe(1);
    const after = getMissionByKey(campaign.id, "load")!;
    expect(after.status).toBe("active");
    expect(after.lockedAt).toBeGreaterThan(0);
    expect(after.specDigest).toBe(recomputeMissionSpecDigest(after, cid));
  });

  it("a locked mission cannot have its economics or prose edited (draft-only)", () => {
    const { campaign, cid } = seedCampaign();
    draft(campaign.id, "load");
    // editable while draft
    expect(updateMissionDraft(getMissionByKey(campaign.id, "load")!.id, { rewardAmount: 600_000 })).toBe(true);
    lockMissionPlan(campaign.id, cid);
    // frozen after lock
    const id = getMissionByKey(campaign.id, "load")!.id;
    expect(updateMissionDraft(id, { rewardAmount: 999_999 })).toBe(false);
    expect(getMissionByKey(campaign.id, "load")!.rewardAmount).toBe(600_000);
  });

  it("close is terminal", () => {
    const { campaign } = seedCampaign();
    const m = draft(campaign.id, "load");
    closeMission(m.id);
    expect(getMissionByKey(campaign.id, "load")!.status).toBe("closed");
  });
});

describe("V2 submission uniqueness (durable, DB-enforced)", () => {
  it("one wallet may submit AT MOST ONCE per mission", () => {
    const { campaign } = seedCampaign();
    const mid = missionIdHash(campaign.id, "load");
    const w = `0x${"a".repeat(40)}`;
    expect(createSubmission({ campaignId: campaign.id, wallet: w, missionIdHash: mid }).ok).toBe(true);
    const dup = createSubmission({ campaignId: campaign.id, wallet: w, missionIdHash: mid });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toBe("duplicate_mission");
  });

  it("the same wallet may submit to DIFFERENT missions", () => {
    const { campaign } = seedCampaign();
    const w = `0x${"c".repeat(40)}`;
    expect(createSubmission({ campaignId: campaign.id, wallet: w, missionIdHash: missionIdHash(campaign.id, "load") }).ok).toBe(true);
    expect(createSubmission({ campaignId: campaign.id, wallet: w, missionIdHash: missionIdHash(campaign.id, "signup") }).ok).toBe(true);
  });

  it("case-insensitive wallet identity — UPPER and lower collide on one mission", () => {
    const { campaign } = seedCampaign();
    const mid = missionIdHash(campaign.id, "load");
    const lower = `0x${"d".repeat(40)}`;
    expect(createSubmission({ campaignId: campaign.id, wallet: lower, missionIdHash: mid }).ok).toBe(true);
    const upper = `0x${"D".repeat(40)}`;
    expect(createSubmission({ campaignId: campaign.id, wallet: upper, missionIdHash: mid }).ok).toBe(false);
  });

  it("two DIFFERENT wallets may submit to the same mission", () => {
    const { campaign } = seedCampaign();
    const mid = missionIdHash(campaign.id, "load");
    expect(createSubmission({ campaignId: campaign.id, wallet: `0x${"1".repeat(40)}`, missionIdHash: mid }).ok).toBe(true);
    expect(createSubmission({ campaignId: campaign.id, wallet: `0x${"2".repeat(40)}`, missionIdHash: mid }).ok).toBe(true);
  });

  it("countPaidForMission reflects real paid submissions", () => {
    const { campaign } = seedCampaign();
    const mid = missionIdHash(campaign.id, "load");
    const r = createSubmission({ campaignId: campaign.id, wallet: `0x${"7".repeat(40)}`, missionIdHash: mid });
    if (!r.ok) throw new Error("seed");
    expect(countPaidForMission(mid)).toBe(0);
    updateSubmission(r.submission.id, { status: "paid" });
    expect(countPaidForMission(mid)).toBe(1);
  });
});

describe("V1 submission semantics unchanged (campaign-level)", () => {
  it("a V1 (no-mission) wallet may submit at most once PER CAMPAIGN", () => {
    const c = createCampaign({
      title: "V1",
      rewardAmount: 500_000,
      vaultAddress: `0x${"1".repeat(40)}`,
      posterWallet: `0x${"2".repeat(40)}`,
      chainId: 59902,
    });
    const w = `0x${"e".repeat(40)}`;
    expect(createSubmission({ campaignId: c.id, wallet: w }).ok).toBe(true);
    const dup = createSubmission({ campaignId: c.id, wallet: w });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toBe("duplicate_wallet");
  });
});

/**
 * P16 multi-tester unblock — the evidence-URL replay index (sub_evidence_unq) must keep rejecting a
 * reused url-lane proof, while OBSERVATION submissions (whose evidence is the shared product URL, stored
 * NULL by the submit route) are exempt so a second, third… tester on one campaign all get through.
 */
describe("evidence-URL uniqueness — url-lane replay preserved, observation exempt", () => {
  const mHash = `0x${"a".repeat(64)}`;

  it("REJECTS a second submission reusing the same evidence URL in a campaign (replay guard byte-identical)", () => {
    const { campaign } = seedCampaign();
    const first = createSubmission({ campaignId: campaign.id, wallet: `0x${"1".repeat(40)}`, evidenceUrl: "https://proof.example/x", missionIdHash: mHash });
    // different wallet → different dedupeKey, so the per-mission index doesn't trip FIRST; the collision
    // is purely on (campaign, evidenceUrl).
    const second = createSubmission({ campaignId: campaign.id, wallet: `0x${"2".repeat(40)}`, evidenceUrl: "https://proof.example/x", missionIdHash: mHash });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("duplicate_evidence");
  });

  it("ACCEPTS three observation submissions with NULL evidence on one campaign (nulls are distinct)", () => {
    const { campaign } = seedCampaign();
    // exactly what the submit route now stores for an observation mission: evidenceUrl = null.
    const a = createSubmission({ campaignId: campaign.id, wallet: `0x${"3".repeat(40)}`, evidenceUrl: null, missionIdHash: mHash });
    const b = createSubmission({ campaignId: campaign.id, wallet: `0x${"4".repeat(40)}`, evidenceUrl: null, missionIdHash: mHash });
    const c = createSubmission({ campaignId: campaign.id, wallet: `0x${"5".repeat(40)}`, evidenceUrl: null, missionIdHash: mHash });
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, true]);
  });
});

/**
 * P20 retry-while-held — a held OBSERVATION submission is revised IN PLACE: one row, one payout per
 * wallet (uniqueness never weakened), attempt counter climbs, and the stale judgment is cleared so the
 * pipeline re-judges the new account fresh. The latest attempt SUPERSEDES the last.
 */
describe("reviseSubmission (P20 retry-while-held)", () => {
  const mHash = `0x${"b".repeat(64)}`;

  it("revises in place: same row id, attempt++, status back to pending, note/evidence replaced", () => {
    const { campaign } = seedCampaign();
    const w = `0x${"a".repeat(40)}`;
    const r = createSubmission({ campaignId: campaign.id, wallet: w, evidenceUrl: null, note: "first try", missionIdHash: mHash });
    if (!r.ok) throw new Error("seed");
    expect(r.submission.attempt).toBe(1);
    updateSubmission(r.submission.id, { status: "pending" });

    const revised = reviseSubmission(r.submission.id, { evidenceUrl: null, note: "I opened the properties panel and read the stroke width" });
    expect(revised?.id).toBe(r.submission.id); // SAME row — no second submission created
    expect(revised?.attempt).toBe(2);
    expect(revised?.status).toBe("pending");
    expect(revised?.note).toBe("I opened the properties panel and read the stroke width");

    // still exactly one row for this (mission, wallet): a retry never multiplies payouts
    expect(getWalletMissionSubmission(mHash, w)?.id).toBe(r.submission.id);
  });

  it("clears the prior decision so the next judgment is fresh (no stale verdict carries over)", () => {
    const { campaign } = seedCampaign();
    const w = `0x${"c".repeat(40)}`;
    const r = createSubmission({ campaignId: campaign.id, wallet: w, evidenceUrl: null, missionIdHash: mHash });
    if (!r.ok) throw new Error("seed");
    insertDecision({
      submissionId: r.submission.id,
      campaignId: campaign.id,
      engine: "heuristic",
      brief: { criteria: [], fraudSignals: [], recommendation: "hold", reasonCode: "no_evidence", confidence: 0, summary: "held", provider: null },
    });
    expect(getDecisionBySubmission(r.submission.id)).not.toBeNull();

    reviseSubmission(r.submission.id, { evidenceUrl: null, note: "more detail" });
    expect(getDecisionBySubmission(r.submission.id)).toBeNull(); // stale judgment gone
  });

  it("attempt climbs 1 → 2 → 3 across successive revises (the cap is enforced by the route, not here)", () => {
    const { campaign } = seedCampaign();
    const w = `0x${"d".repeat(40)}`;
    const r = createSubmission({ campaignId: campaign.id, wallet: w, evidenceUrl: null, missionIdHash: mHash });
    if (!r.ok) throw new Error("seed");
    reviseSubmission(r.submission.id, { evidenceUrl: null, note: "second" });
    reviseSubmission(r.submission.id, { evidenceUrl: null, note: "third" });
    expect(getSubmission(r.submission.id)?.attempt).toBe(3);
  });
});
