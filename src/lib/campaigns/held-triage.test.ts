import { describe, expect, it } from "vitest";
import {
  createCampaign,
  createMission,
  createSubmission,
  insertDecision,
  setObservationShadow,
} from "@/lib/db/campaigns";
import { computeCampaignPlan, missionIdHash } from "@/lib/campaigns/mission-plan";
import type { Campaign } from "@/lib/db/schema";
import type { ObservationShadow } from "@/lib/deputy/observation-judge";
import { buildHeldTriage, autonomousResolutionStats } from "./held-triage";

/**
 * P22 triage — the recommendation is DETERMINISTIC (counts + flags, never the note) and CONSERVATIVE:
 * "pay" only on an objective bar pass, "reject" only on fraud/near-dup/zero-match, else "you-decide".
 * The metric is the honest ≥90% gauge over observation shadows.
 */

let seq = 0;
function seed(): { campaign: Campaign; mHash: string } {
  seq++;
  const c = createCampaign({
    title: "Obs campaign",
    rewardAmount: 500_000,
    vaultAddress: `0x${"1".repeat(40)}`,
    posterWallet: `0x${(seq % 10).toString().repeat(40)}`,
    chainId: 2345,
    vaultKind: "campaign_v2",
  });
  const plan = computeCampaignPlan(c.id, [{ missionKey: "explore", rewardBase: BigInt(500_000), maxCompletions: BigInt(3) }]);
  const campaign = { ...c, campaignIdHash: plan.campaignIdHash } as Campaign;
  const mHash = missionIdHash(c.id, "explore");
  createMission({
    campaignId: c.id, missionKey: "explore", missionIdHash: mHash,
    title: "Explore the world", objective: "look around", instructions: "1. look",
    targetSurface: "https://x.example", criteria: ["saw it"], evidenceList: ["a note"],
    rewardAmount: 500_000, maxCompletions: 3, status: "active", displayOrder: 0,
  });
  return { campaign, mHash };
}

function shadow(over: Partial<ObservationShadow>): ObservationShadow {
  return {
    distinctSources: 2, matchedCount: 3, keyDistinctSources: 6, obsConfidence: 0,
    validatedContradictions: 0, unverifiedContradictions: 0, nearDupSimilarity: 0,
    injectionDetected: false, barPass: false, barReasons: ["few_matches(2<3)"],
    legacyBarPass: false, legacyBarReasons: [], corpusDigest: "0x0", wouldAutopay: false, at: 0,
    ...over,
  };
}

function heldWithShadow(campaign: Campaign, mHash: string, wallet: string, sh: ObservationShadow) {
  const r = createSubmission({ campaignId: campaign.id, wallet, evidenceUrl: null, note: "n", missionIdHash: mHash });
  if (!r.ok) throw new Error("seed submission");
  insertDecision({ submissionId: r.submission.id, campaignId: campaign.id, engine: "llm", brief: { criteria: [], fraudSignals: [], recommendation: "hold", reasonCode: "no_evidence", confidence: 0, summary: "", provider: null } });
  setObservationShadow(r.submission.id, sh as unknown as Record<string, unknown>);
  return r.submission;
}

describe("buildHeldTriage — deterministic, conservative lean", () => {
  it("bar PASSED (held only for arming) → lean pay, with the objective count", () => {
    const { campaign, mHash } = seed();
    const sub = heldWithShadow(campaign, mHash, `0x${"a".repeat(40)}`, shadow({ barPass: true, barReasons: [], distinctSources: 4, keyDistinctSources: 6 }));
    const t = buildHeldTriage(campaign, sub);
    expect(t.lane).toBe("observation");
    expect(t.lean).toBe("pay");
    expect(t.leanWhy).toContain("4 of 6");
    expect(t.matched).toBe(4);
  });

  it("a fraud signal → lean reject (an attack, whatever else it scored)", () => {
    const { campaign, mHash } = seed();
    const sub = heldWithShadow(campaign, mHash, `0x${"b".repeat(40)}`, shadow({ injectionDetected: true, distinctSources: 9, barReasons: ["high_fraud"] }));
    const t = buildHeldTriage(campaign, sub);
    expect(t.fraudFlagged).toBe(true);
    expect(t.lean).toBe("reject");
  });

  it("a near-duplicate → lean reject (possible farming)", () => {
    const { campaign, mHash } = seed();
    const sub = heldWithShadow(campaign, mHash, `0x${"c".repeat(40)}`, shadow({ barReasons: ["near_dup"], distinctSources: 3 }));
    const t = buildHeldTriage(campaign, sub);
    expect(t.nearDup).toBe(true);
    expect(t.lean).toBe("reject");
  });

  it("zero firsthand match → lean reject (reads generic)", () => {
    const { campaign, mHash } = seed();
    const sub = heldWithShadow(campaign, mHash, `0x${"d".repeat(40)}`, shadow({ distinctSources: 0, barReasons: ["few_matches(0<3)"] }));
    expect(buildHeldTriage(campaign, sub).lean).toBe("reject");
  });

  it("partial genuine-looking match (no fraud) → lean YOU-DECIDE, never a pay nudge", () => {
    const { campaign, mHash } = seed();
    const sub = heldWithShadow(campaign, mHash, `0x${"e".repeat(40)}`, shadow({ distinctSources: 2, keyDistinctSources: 6, barReasons: ["few_matches(2<3)"] }));
    const t = buildHeldTriage(campaign, sub);
    expect(t.lean).toBe("you-decide");
    expect(t.leanWhy).toContain("2 of 6");
    expect(t.heldBecause[0]).toMatch(/fewer of Sage's firsthand observations/);
  });

  it("the lean is UNSWAYED by the note (deterministic) — identical shadow → identical lean", () => {
    const { campaign, mHash } = seed();
    const sh = shadow({ distinctSources: 2 });
    const a = heldWithShadow(campaign, mHash, `0x${"1".repeat(40)}`, sh);
    const b = heldWithShadow(campaign, mHash, `0x${"2".repeat(40)}`, sh);
    expect(buildHeldTriage(campaign, a).lean).toBe(buildHeldTriage(campaign, b).lean);
  });
});

describe("autonomousResolutionStats — the honest ≥90% gauge", () => {
  it("counts wouldPay (barPass) + fraudFlagged, and the residual needsYou", () => {
    const { campaign, mHash } = seed();
    // 3 would-pay, 1 fraud, 1 needs-you = 5 total → rate 4/5 = 0.8
    heldWithShadow(campaign, mHash, `0x${"a1".repeat(20)}`, shadow({ barPass: true, barReasons: [] }));
    heldWithShadow(campaign, mHash, `0x${"a2".repeat(20)}`, shadow({ barPass: true, barReasons: [] }));
    heldWithShadow(campaign, mHash, `0x${"a3".repeat(20)}`, shadow({ barPass: true, barReasons: [] }));
    heldWithShadow(campaign, mHash, `0x${"a4".repeat(20)}`, shadow({ injectionDetected: true, barReasons: ["high_fraud"] }));
    heldWithShadow(campaign, mHash, `0x${"a5".repeat(20)}`, shadow({ distinctSources: 2, barReasons: ["few_matches(2<3)"] }));
    const s = autonomousResolutionStats(campaign.id);
    expect(s.total).toBe(5);
    expect(s.wouldPay).toBe(3);
    expect(s.fraudFlagged).toBe(1);
    expect(s.needsYou).toBe(1);
    expect(s.rate).toBeCloseTo(0.8);
  });

  it("a campaign with no observation decisions → zero rate, never NaN", () => {
    const { campaign } = seed();
    const s = autonomousResolutionStats(campaign.id);
    expect(s.total).toBe(0);
    expect(s.rate).toBe(0);
  });
});
