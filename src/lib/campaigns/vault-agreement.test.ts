import { describe, expect, it } from "vitest";
import {
  checkVaultAgreement,
  type ChainCampaignSnapshot,
  type DbCampaignPlan,
} from "./vault-agreement";

const OWNER = "0xb77e6f5466cf52524e8465859277f192Be0bCfe4";
const OPERATOR = "0x7704E5BEe00Ef085dde85EEB0c49ae12d9F9BC35";
const TOKEN = "0xF176f521290A937d81cc5878dfc19908f4D681A1";
const CID = `0x${"a".repeat(64)}`;
const PLAN = `0x${"b".repeat(64)}`;
const M1 = `0x${"1".repeat(64)}`;
const M2 = `0x${"2".repeat(64)}`;

function db(): DbCampaignPlan {
  return {
    chainId: 59902,
    vaultKind: "campaign_v2",
    ownerFounder: OWNER,
    operatorConfigured: OPERATOR,
    token: TOKEN,
    campaignIdHash: CID,
    missionPlanDigest: PLAN,
    budgetBase: BigInt(35_000_000),
    missions: [
      { missionIdHash: M1, rewardBase: BigInt(10_000_000), maxCompletions: BigInt(2) },
      { missionIdHash: M2, rewardBase: BigInt(5_000_000), maxCompletions: BigInt(3) },
    ],
  };
}

function chain(): ChainCampaignSnapshot {
  return {
    factoryRecognizes: true,
    owner: OWNER,
    operator: OPERATOR,
    guardian: "0x0000000000000000000000000000000000000000",
    token: TOKEN,
    campaignIdHash: CID,
    missionPlanDigest: PLAN,
    budgetCeiling: BigInt(35_000_000),
    chainId: 59902,
    state: "active",
    replaySupport: "supported",
    missions: {
      [M1.toLowerCase()]: { exists: true, rewardBase: BigInt(10_000_000), maxCompletions: BigInt(2) },
      [M2.toLowerCase()]: { exists: true, rewardBase: BigInt(5_000_000), maxCompletions: BigInt(3) },
    },
  };
}

const fields = (db2: DbCampaignPlan, c: ChainCampaignSnapshot) =>
  checkVaultAgreement(db2, c).mismatches.map((x) => x.field);

describe("checkVaultAgreement", () => {
  it("a fully-agreeing plan passes", () => {
    const r = checkVaultAgreement(db(), chain());
    expect(r.ok).toBe(true);
    expect(r.mismatches).toHaveLength(0);
  });

  it("every disagreement is reported with its field", () => {
    expect(fields(db(), { ...chain(), factoryRecognizes: false })).toContain("provenance");
    expect(fields(db(), { ...chain(), owner: OPERATOR })).toContain("owner_not_founder");
    expect(fields({ ...db(), operatorConfigured: OWNER }, { ...chain(), operator: OWNER })).toContain("owner_equals_operator");
    expect(fields(db(), { ...chain(), operator: `0x${"9".repeat(40)}` })).toContain("operator_mismatch");
    expect(fields(db(), { ...chain(), guardian: OPERATOR })).toContain("guardian_equals_operator");
    expect(fields(db(), { ...chain(), campaignIdHash: `0x${"c".repeat(64)}` })).toContain("campaign_id_hash");
    expect(fields(db(), { ...chain(), missionPlanDigest: `0x${"d".repeat(64)}` })).toContain("mission_plan_digest");
    expect(fields(db(), { ...chain(), token: `0x${"e".repeat(40)}` })).toContain("token");
    expect(fields(db(), { ...chain(), budgetCeiling: BigInt(34_000_000) })).toContain("budget");
    expect(fields(db(), { ...chain(), chainId: 2345 })).toContain("chain_id");
    expect(fields(db(), { ...chain(), replaySupport: "legacy" })).toContain("replay_support");
    expect(fields(db(), { ...chain(), replaySupport: "unreadable" })).toContain("replay_support");
    expect(fields(db(), { ...chain(), state: "revoked" })).toContain("lifecycle");
  });

  it("mission-level mismatches: missing / wrong reward / wrong cap", () => {
    const noM2 = chain();
    delete noM2.missions[M2.toLowerCase()];
    expect(fields(db(), noM2)).toContain("mission_missing");

    const badReward = chain();
    badReward.missions[M1.toLowerCase()] = { exists: true, rewardBase: BigInt(9_999_999), maxCompletions: BigInt(2) };
    expect(fields(db(), badReward)).toContain("mission_reward");

    const badCap = chain();
    badCap.missions[M1.toLowerCase()] = { exists: true, rewardBase: BigInt(10_000_000), maxCompletions: BigInt(3) };
    expect(fields(db(), badCap)).toContain("mission_max_completions");
  });

  it("a non-campaign_v2 db row is flagged", () => {
    expect(fields({ ...db(), vaultKind: "policy_v1" }, chain())).toContain("vault_kind");
  });
});
