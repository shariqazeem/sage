import { describe, expect, it } from "vitest";

import { checkVaultAgreement, type ChainCampaignSnapshot } from "./vault-agreement";

/**
 * A CAMPAIGN ID IS 256 BITS; A FELT IS 251.
 *
 * The Cairo vault stores the reduction of exactly the digest the database holds, so a raw hex
 * comparison calls the two different. A founder was told "The vault on chain does not match this
 * plan (campaign_id_hash, mission_plan_digest, mission_missing)" about a vault whose campaign id
 * was, after reduction, identical byte for byte — and whose missions were all present, just keyed
 * by the felt the contract was written with.
 *
 * Three symptoms, one cause.
 */

const MASK = (BigInt(1) << BigInt(251)) - BigInt(1);
const reduce = (h: string) => `0x${(BigInt(h) & MASK).toString(16)}`;

// The real values from the funded vault that was refused.
const CAMPAIGN_ID = "0x0d380cfa32d715c8dcd712d2dc45512461653647cca64878b61d025b4357ba4b";
const PLAN_DIGEST = "0x18a1744393b560fb4898a9d832b9a75b604cbd00fa9bf592fd2beacd86641ed9";
const MISSION = "0xaa11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff22aa33bb44cc55dd66";

const db = {
  vaultKind: "sage_vault_starknet" as const,
  campaignIdHash: CAMPAIGN_ID,
  missionPlanDigest: PLAN_DIGEST,
  ownerFounder: "0x4f1f",
  operatorConfigured: "0x46a1",
  token: "0x330",
  budgetBase: BigInt(1_000_000),
  chainId: 900_001,
  missions: [{ missionIdHash: MISSION, rewardBase: BigInt(500_000), maxCompletions: BigInt(2) }],
};

/** What the Cairo vault actually reports: everything reduced into the field. */
const chain: ChainCampaignSnapshot = {
  factoryRecognizes: true,
  owner: "0x4f1f",
  operator: "0x46a1",
  guardian: "0x0000000000000000000000000000000000000000",
  token: "0x330",
  campaignIdHash: reduce(CAMPAIGN_ID),
  missionPlanDigest: reduce(PLAN_DIGEST),
  budgetCeiling: BigInt(1_000_000),
  chainId: 900_001,
  state: "active",
  replaySupport: "supported",
  missions: { [reduce(MISSION)]: { exists: true, rewardBase: BigInt(500_000), maxCompletions: BigInt(2) } },
};

describe("a Starknet vault holding the reduced form of the same plan", () => {
  it("agrees — the exact case that was refused", () => {
    const r = checkVaultAgreement(db, chain);
    expect(r.mismatches.map((m) => m.field)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("still finds a mission keyed by its reduced felt", () => {
    // `mission_missing` was the same bug wearing a different name.
    expect(checkVaultAgreement(db, chain).mismatches.map((m) => m.field)).not.toContain(
      "mission_missing",
    );
  });
});

describe("it did not become a check that passes anything", () => {
  it("still refuses a DIFFERENT campaign id", () => {
    const other = { ...chain, campaignIdHash: reduce(`0x${"9".repeat(64)}`) };
    expect(checkVaultAgreement(db, other).mismatches.map((m) => m.field)).toContain(
      "campaign_id_hash",
    );
  });

  it("still refuses a DIFFERENT mission plan digest", () => {
    const other = { ...chain, missionPlanDigest: reduce(`0x${"7".repeat(64)}`) };
    expect(checkVaultAgreement(db, other).mismatches.map((m) => m.field)).toContain(
      "mission_plan_digest",
    );
  });

  it("still refuses a mission the vault does not hold", () => {
    const other = { ...chain, missions: {} };
    expect(checkVaultAgreement(db, other).mismatches.map((m) => m.field)).toContain(
      "mission_missing",
    );
  });

  it("still refuses a mission repriced on chain", () => {
    const other = {
      ...chain,
      missions: { [reduce(MISSION)]: { exists: true, rewardBase: BigInt(999), maxCompletions: BigInt(2) } },
    };
    expect(checkVaultAgreement(db, other).mismatches.map((m) => m.field)).toContain(
      "mission_reward",
    );
  });

  it("leaves an EVM vault comparing exactly as before — full digests, unreduced", () => {
    const evmDb = { ...db, vaultKind: "campaign_v2" as const, chainId: 2345 };
    const evmChain = {
      ...chain,
      chainId: 2345,
      campaignIdHash: CAMPAIGN_ID,
      missionPlanDigest: PLAN_DIGEST,
      missions: { [MISSION.toLowerCase()]: { exists: true, rewardBase: BigInt(500_000), maxCompletions: BigInt(2) } },
    };
    expect(checkVaultAgreement(evmDb, evmChain).ok).toBe(true);
  });
});
