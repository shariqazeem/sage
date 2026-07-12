import { describe, expect, it } from "vitest";
import { campaignIdHash, computeCampaignPlan, missionIdHash } from "./mission-plan";
import { missionSpecDigest } from "./mission-spec";
import {
  identityMismatchSummary,
  missionToIdentity,
  verifyPublicIdentity,
  type IdentityMission,
  type PublicIdentityInput,
} from "./public-identity";
import type { Mission } from "@/lib/db/schema";

/**
 * The public-identity invariant: everything is recomputed from the PUBLIC records and
 * compared to the stored / submitted / on-chain values. A stored hash that merely
 * matches the chain is NOT enough — it must also equal the recompute from the public id.
 * This is the exact defect the live exercise exposed (a random public id whose stored
 * campaignIdHash still matched the chain), now caught before any payment.
 */

const PUB = "founding-testers";
const PROSE = {
  title: "Verify the fixture",
  objective: "Confirm the page contains the phrase",
  instructions: "Open the URL and locate the phrase",
  targetSurface: "https://app.example.com/fixture",
  criteria: ["The evidence contains the phrase"],
  evidenceList: ["The source URL"],
};
const REWARD = BigInt(100_000);
const CAP = BigInt(1);

const CID = campaignIdHash(PUB);
const MID = missionIdHash(PUB, "verify");
const PLAN = computeCampaignPlan(PUB, [{ missionKey: "verify", rewardBase: REWARD, maxCompletions: CAP }])
  .missionPlanDigest;
const SPEC = missionSpecDigest({
  campaignIdHash: CID,
  missionIdHash: MID,
  ...PROSE,
  evidenceRequirements: PROSE.evidenceList,
  rewardBase: REWARD,
  maxCompletions: CAP,
});

function mission(over: Partial<IdentityMission> = {}): IdentityMission {
  return {
    missionKey: "verify",
    missionIdHash: MID,
    specDigest: SPEC,
    ...PROSE,
    rewardBase: REWARD,
    maxCompletions: CAP,
    ...over,
  };
}

function input(over: Partial<PublicIdentityInput> = {}): PublicIdentityInput {
  return {
    publicCampaignId: PUB,
    storedCampaignIdHash: CID,
    storedMissionPlanDigest: PLAN,
    missions: [mission()],
    submission: { missionIdHash: MID, missionSpecDigest: SPEC },
    onchain: { campaignIdHash: CID, missionPlanDigest: PLAN },
    ...over,
  };
}

const reasons = (r: ReturnType<typeof verifyPublicIdentity>) => r.mismatches.map((m) => m.reason);

describe("verifyPublicIdentity — canonical identity passes", () => {
  it("a fully consistent campaign_v2 record verifies", () => {
    const r = verifyPublicIdentity(input());
    expect(r.ok).toBe(true);
    expect(r.mismatches).toHaveLength(0);
    expect(r.recomputed.campaignIdHash).toBe(CID);
    expect(r.recomputed.missionPlanDigest).toBe(PLAN);
  });
  it("a null stored spec digest skips the spec comparison (no false mismatch)", () => {
    const r = verifyPublicIdentity(input({ missions: [mission({ specDigest: null })] }));
    expect(r.ok).toBe(true);
  });
  it("no submission / no on-chain still verifies the local identity", () => {
    const r = verifyPublicIdentity(input({ submission: null, onchain: null }));
    expect(r.ok).toBe(true);
  });
});

describe("verifyPublicIdentity — THE live defect: public id disagrees with stored/on-chain", () => {
  it("a random public id whose stored+on-chain campaignIdHash came from a DIFFERENT id fails closed", () => {
    // stored + on-chain hashes are internally consistent (they'd pass the old agreement
    // check) but neither equals campaignIdHash(randomPublicId).
    const r = verifyPublicIdentity(
      input({
        publicCampaignId: "U-hSP_elbp", // the random DB id from the exercise
        // stored/on-chain remain the CANONICAL id's hashes → the exact live bug.
      }),
    );
    expect(r.ok).toBe(false);
    expect(reasons(r)).toContain("public_campaign_id_hash_mismatch");
    // the mission + plan recomputes from the random id also diverge.
    expect(reasons(r)).toContain("public_mission_id_hash_mismatch");
    expect(reasons(r)).toContain("mission_plan_recomputation_mismatch");
  });
});

describe("verifyPublicIdentity — each identity field is load-bearing", () => {
  it("stored campaignIdHash mismatch → public_campaign_id_hash_mismatch", () => {
    const r = verifyPublicIdentity(input({ storedCampaignIdHash: `0x${"9".repeat(64)}` }));
    expect(reasons(r)).toContain("public_campaign_id_hash_mismatch");
  });
  it("on-chain campaignIdHash mismatch → public_campaign_id_hash_mismatch", () => {
    const r = verifyPublicIdentity(
      input({ onchain: { campaignIdHash: `0x${"9".repeat(64)}`, missionPlanDigest: PLAN } }),
    );
    expect(reasons(r)).toContain("public_campaign_id_hash_mismatch");
  });
  it("wrong stored missionIdHash → public_mission_id_hash_mismatch", () => {
    const r = verifyPublicIdentity(input({ missions: [mission({ missionIdHash: `0x${"a".repeat(64)}` })] }));
    expect(reasons(r)).toContain("public_mission_id_hash_mismatch");
  });
  it("drifted mission spec digest → mission_spec_digest_mismatch", () => {
    const r = verifyPublicIdentity(input({ missions: [mission({ specDigest: `0x${"b".repeat(64)}` })] }));
    expect(reasons(r)).toContain("mission_spec_digest_mismatch");
  });
  it("edited mission prose (spec no longer recomputes to stored) → mission_spec_digest_mismatch", () => {
    const r = verifyPublicIdentity(
      input({ missions: [mission({ objective: "a different objective than was locked" })] }),
    );
    expect(reasons(r)).toContain("mission_spec_digest_mismatch");
  });
  it("stored missionPlanDigest mismatch → mission_plan_recomputation_mismatch", () => {
    const r = verifyPublicIdentity(input({ storedMissionPlanDigest: `0x${"c".repeat(64)}` }));
    expect(reasons(r)).toContain("mission_plan_recomputation_mismatch");
  });
  it("on-chain missionPlanDigest mismatch → mission_plan_recomputation_mismatch", () => {
    const r = verifyPublicIdentity(input({ onchain: { campaignIdHash: CID, missionPlanDigest: `0x${"d".repeat(64)}` } }));
    expect(reasons(r)).toContain("mission_plan_recomputation_mismatch");
  });
  it("mission-plan digest changes when a reward is altered (economics are covered)", () => {
    const r = verifyPublicIdentity(input({ missions: [mission({ rewardBase: BigInt(100_001) })] }));
    // reward drift changes both the recomputed plan AND the recomputed spec digest.
    expect(reasons(r)).toContain("mission_plan_recomputation_mismatch");
  });
});

describe("verifyPublicIdentity — submission mission identity", () => {
  it("a submission targeting a mission not in the plan → submission_mission_identity_mismatch", () => {
    const r = verifyPublicIdentity(input({ submission: { missionIdHash: `0x${"e".repeat(64)}`, missionSpecDigest: SPEC } }));
    expect(reasons(r)).toContain("submission_mission_identity_mismatch");
  });
  it("a submission whose captured spec digest does not match the mission's → submission_mission_identity_mismatch", () => {
    const r = verifyPublicIdentity(input({ submission: { missionIdHash: MID, missionSpecDigest: `0x${"f".repeat(64)}` } }));
    expect(reasons(r)).toContain("submission_mission_identity_mismatch");
  });
});

describe("missionToIdentity + summary", () => {
  it("maps a persisted mission row into the recompute shape", () => {
    const row = {
      missionKey: "verify",
      missionIdHash: MID,
      specDigest: SPEC,
      title: PROSE.title,
      objective: PROSE.objective,
      instructions: PROSE.instructions,
      targetSurface: PROSE.targetSurface,
      criteria: PROSE.criteria,
      evidenceList: PROSE.evidenceList,
      rewardAmount: 100_000,
      maxCompletions: 1,
    } as unknown as Mission;
    const im = missionToIdentity(row);
    expect(im.rewardBase).toBe(REWARD);
    expect(im.maxCompletions).toBe(CAP);
    expect(verifyPublicIdentity(input({ missions: [im] })).ok).toBe(true);
  });
  it("summary dedupes reasons", () => {
    const r = verifyPublicIdentity(input({ publicCampaignId: "totally-different-id" }));
    expect(identityMismatchSummary(r)).toMatch(/public_campaign_id_hash_mismatch/);
  });
});
