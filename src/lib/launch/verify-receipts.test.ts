import { describe, expect, it } from "vitest";
import { getAddress, type Hex } from "viem";

import { verifyCreate, verifyApprove, verifyFund, verifyActivate, type ChainVerifier, type CreateReceiptRead } from "./verify-receipts";
import { deriveDeploymentInputs, type DeploymentSettings } from "./deploy-plan";
import type { DeploymentReadyPlan } from "./approve";
import type { ChainCampaignSnapshot } from "@/lib/campaigns/vault-agreement";
import type { Deployment } from "@/lib/db/schema";

/**
 * Receipt verification is where "the server never trusts the client's success" lives.
 * These tests drive the REAL verification logic with a stub chain and assert that EVERY
 * disagreement with the approved plan is rejected — a create that emits a different vault,
 * a snapshot whose owner/operator/token/hashes/rewards/caps/budget differ, an allowance or
 * balance short of the budget, a vault that isn't active. A pass means none of those can
 * ever reach `live`.
 */

const OWNER = getAddress("0xb77e6f5466cf52524e8465859277f192Be0bCfe4");
const OPERATOR = getAddress("0x7704E5BEe00Ef085dde85EEB0c49ae12d9F9BC35");
const GUARDIAN = OWNER;
const TOKEN = getAddress("0xF176f521290A937d81cc5878dfc19908f4D681A1");
const FACTORY = getAddress("0x2249b773aFEd5594985F7D350581A1b55f279C7f");
const VAULT = getAddress("0x73Ce425A84B1c2e4F19c7cB9f5d745EE529e4972");
const CID = "0x4a5024d5af6dfe32e1ae40fb73978a8e1c793ef157109316ed2db31d868d10e7" as Hex;
const MID = "0x9af3313cb0b13822c9caaab12045888fbf36fcfa80ef85ddb76bb5b3c000c6f3" as Hex;

const plan: DeploymentReadyPlan = {
  schemaVersion: 1, publicCampaignId: "acme", campaignIdHash: CID,
  missionPlanDigest: "0x48f6d45295be7b0b4b85ab99846e5dec29408a7c101eeb63865abeef31d803d2" as Hex,
  tokenDecimals: 6, totalBudgetBase: "100000",
  missions: [{ missionKey: "verify", missionIdHash: MID, specDigest: `0x${"0".repeat(64)}` as Hex, title: "t", objective: "o", instructions: "i", targetSurface: "https://x", criteria: ["c"], evidenceRequirements: ["e"], rewardBase: "100000", maxCompletions: "1" }],
};
const settings: DeploymentSettings = {
  chainId: 59902, factory: FACTORY, owner: OWNER, operator: OPERATOR, guardian: GUARDIAN, token: TOKEN,
  dailyVelocityCap: BigInt(100_000), durationSeconds: BigInt(604_800),
};
const deployment = { predictedVault: VAULT, deployedVault: VAULT, createTx: "0xcreate", approveTx: "0xapprove", fundTx: "0xfund", activateTx: "0xactivate" } as unknown as Deployment;

function goodSnapshot(over: Partial<ChainCampaignSnapshot> = {}): ChainCampaignSnapshot {
  const inputs = deriveDeploymentInputs(plan);
  const missions: ChainCampaignSnapshot["missions"] = {};
  inputs.missionIds.forEach((m, i) => { missions[m.toLowerCase()] = { exists: true, rewardBase: inputs.rewards[i], maxCompletions: inputs.maxCompletions[i] }; });
  return {
    factoryRecognizes: true, owner: OWNER, operator: OPERATOR, guardian: GUARDIAN, token: TOKEN,
    campaignIdHash: CID, missionPlanDigest: plan.missionPlanDigest, budgetCeiling: BigInt(100_000),
    chainId: 59902, state: "active", replaySupport: "supported", missions, ...over,
  };
}

function verifier(opts: {
  created?: CreateReceiptRead; snapshot?: ChainCampaignSnapshot; allowance?: bigint; balance?: bigint;
}): ChainVerifier {
  return {
    async readCreatedVault() { return opts.created ?? { ok: true, emittedVault: VAULT }; },
    async readSnapshot() { return opts.snapshot ?? goodSnapshot(); },
    async readAllowance() { return opts.allowance ?? BigInt(100_000); },
    async readBalance() { return opts.balance ?? BigInt(100_000); },
    async receiptSucceeded() { return true; },
  };
}

describe("verifyCreate — the deployed vault must match the approved plan exactly", () => {
  it("accepts a faithful create + snapshot", async () => {
    const r = await verifyCreate(deployment, plan, settings, verifier({}));
    expect(r).toEqual({ ok: true, deployedVault: VAULT });
  });
  it("rejects an emitted vault that isn't the CREATE2 prediction", async () => {
    const r = await verifyCreate(deployment, plan, settings, verifier({ created: { ok: true, emittedVault: getAddress(`0x${"9".repeat(40)}`) } }));
    expect(r).toEqual({ ok: false, reason: "emitted_vault_ne_predicted" });
  });
  it("rejects a reverted create receipt", async () => {
    const r = await verifyCreate(deployment, plan, settings, verifier({ created: { ok: false, reason: "create_reverted" } }));
    expect(r).toEqual({ ok: false, reason: "create_reverted" });
  });

  const mismatches: [string, Partial<ChainCampaignSnapshot>, string][] = [
    ["owner", { owner: getAddress(`0x${"1".repeat(40)}`) }, "owner_mismatch"],
    ["operator", { operator: getAddress(`0x${"2".repeat(40)}`) }, "operator_mismatch"],
    ["token", { token: getAddress(`0x${"3".repeat(40)}`) }, "token_mismatch"],
    ["campaignIdHash", { campaignIdHash: `0x${"c".repeat(64)}` }, "campaign_id_hash_mismatch"],
    ["missionPlanDigest", { missionPlanDigest: `0x${"d".repeat(64)}` }, "mission_plan_digest_mismatch"],
    ["budget", { budgetCeiling: BigInt(999) }, "budget_ceiling_mismatch"],
    ["factory-provenance", { factoryRecognizes: false }, "factory_does_not_recognize_vault"],
    ["chain", { chainId: 1 }, "wrong_chain"],
    ["reward", { missions: { [MID.toLowerCase()]: { exists: true, rewardBase: BigInt(1), maxCompletions: BigInt(1) } } }, "mission_reward_mismatch"],
    ["cap", { missions: { [MID.toLowerCase()]: { exists: true, rewardBase: BigInt(100_000), maxCompletions: BigInt(9) } } }, "mission_cap_mismatch"],
  ];
  for (const [name, over, reason] of mismatches) {
    it(`rejects a ${name} mismatch → ${reason}`, async () => {
      const r = await verifyCreate(deployment, plan, settings, verifier({ snapshot: goodSnapshot(over) }));
      expect(r).toEqual({ ok: false, reason });
    });
  }
});

describe("verifyApprove / verifyFund / verifyActivate", () => {
  it("approve requires allowance ≥ the exact budget", async () => {
    expect(await verifyApprove(deployment, plan, settings, verifier({ allowance: BigInt(100_000) }))).toEqual({ ok: true });
    expect(await verifyApprove(deployment, plan, settings, verifier({ allowance: BigInt(99_999) }))).toEqual({ ok: false, reason: "allowance_below_budget" });
  });
  it("fund requires the vault balance ≥ the exact budget", async () => {
    expect(await verifyFund(deployment, plan, settings, verifier({ balance: BigInt(100_000) }))).toEqual({ ok: true });
    expect(await verifyFund(deployment, plan, settings, verifier({ balance: BigInt(0) }))).toEqual({ ok: false, reason: "vault_balance_below_budget" });
  });
  it("activate requires the vault to read active", async () => {
    expect(await verifyActivate(deployment, plan, settings, verifier({ snapshot: goodSnapshot({ state: "active" }) }))).toEqual({ ok: true });
    expect(await verifyActivate(deployment, plan, settings, verifier({ snapshot: goodSnapshot({ state: "funded" }) }))).toEqual({ ok: false, reason: "vault_not_active:funded" });
  });
});
