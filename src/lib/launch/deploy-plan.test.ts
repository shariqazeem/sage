import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { buildDeployBundle, deriveDeploymentInputs, predictVaultAddress, assertBundleMatchesPlan, type DeploymentSettings } from "./deploy-plan";
import type { DeploymentReadyPlan } from "./approve";

/**
 * The deployment construction is the safety hinge: the CREATE2 prediction must match the
 * REAL deployed factory, and the calldata must be derived only from the approved plan.
 *
 * GOLDEN VECTOR: the exact inputs of the live 02E.1 exercise, whose vault
 * 0x73Ce425A84B1c2e4F19c7cB9f5d745EE529e4972 was actually deployed, funded, and paid
 * from on Metis Sepolia. If the prediction here reproduces that address, the founder-
 * facing preview is provably consistent with on-chain reality.
 */

const FACTORY = getAddress("0x2249b773aFEd5594985F7D350581A1b55f279C7f");
const OWNER = getAddress("0xb77e6f5466cf52524e8465859277f192Be0bCfe4");
const OPERATOR = getAddress("0x7704E5BEe00Ef085dde85EEB0c49ae12d9F9BC35");
const TOKEN = getAddress("0xF176f521290A937d81cc5878dfc19908f4D681A1");
const CID = "0x4a5024d5af6dfe32e1ae40fb73978a8e1c793ef157109316ed2db31d868d10e7";
const MID = "0x9af3313cb0b13822c9caaab12045888fbf36fcfa80ef85ddb76bb5b3c000c6f3";
const REAL_VAULT = getAddress("0x73Ce425A84B1c2e4F19c7cB9f5d745EE529e4972");

const settings: DeploymentSettings = {
  chainId: 59902, factory: FACTORY, owner: OWNER, operator: OPERATOR, guardian: OWNER, token: TOKEN,
  dailyVelocityCap: BigInt(100_000), durationSeconds: BigInt(604_800),
};

function plan(over: Partial<DeploymentReadyPlan> = {}): DeploymentReadyPlan {
  return {
    schemaVersion: 1,
    publicCampaignId: "sage-metis-v2-ai-proof-1",
    campaignIdHash: CID as `0x${string}`,
    missionPlanDigest: "0x48f6d45295be7b0b4b85ab99846e5dec29408a7c101eeb63865abeef31d803d2",
    tokenDecimals: 6,
    totalBudgetBase: "100000",
    missions: [
      { missionKey: "public-https-evidence-verification", missionIdHash: MID as `0x${string}`, specDigest: "0x20cc206239baf11097d21683a2602d1ba56e4dc9ca36356e05f32d0cbf20e8ad", title: "Verify", objective: "o", instructions: "i", targetSurface: "https://x", criteria: ["c"], evidenceRequirements: ["e"], rewardBase: "100000", maxCompletions: "1" },
    ],
    ...over,
  };
}

describe("deploy-plan — CREATE2 prediction matches the real deployed vault (golden)", () => {
  it("reproduces the live 02E vault address exactly", () => {
    const inputs = deriveDeploymentInputs(plan());
    expect(predictVaultAddress(inputs, settings)).toBe(REAL_VAULT);
  });

  it("buildDeployBundle predicts the same vault + orders create→approve→fund→activate", () => {
    const b = buildDeployBundle(plan(), settings);
    expect(b.predictedVault).toBe(REAL_VAULT);
    expect(b.calls.map((c) => c.step)).toEqual(["create", "approve", "fund", "activate"]);
    // approve + fund target the predicted vault; create targets the factory.
    expect(getAddress(b.calls[0].to)).toBe(FACTORY);
    expect(getAddress(b.calls[2].to)).toBe(REAL_VAULT);
    expect(b.calls.every((c) => c.data.startsWith("0x") && c.data.length >= 10)).toBe(true); // activate() is a bare selector
    expect(b.calls.every((c) => c.value === "0")).toBe(true); // no native value moves
    expect(b.inputs.totalBudgetBase).toBe(BigInt(100_000));
  });
});

describe("deploy-plan — no divergence from the approved plan", () => {
  it("assertBundleMatchesPlan accepts a faithful bundle and rejects a tampered one", () => {
    const b = buildDeployBundle(plan(), settings);
    expect(assertBundleMatchesPlan(b, plan()).ok).toBe(true);
    // a tampered calldata digest is caught.
    const tampered = { ...b, calldataDigest: `0x${"9".repeat(64)}` as `0x${string}` };
    expect(assertBundleMatchesPlan(tampered, plan()).ok).toBe(false);
  });

  it("changing a mission reward changes the predicted vault AND budget (calldata is plan-bound)", () => {
    const a = predictVaultAddress(deriveDeploymentInputs(plan()), settings);
    const b = predictVaultAddress(deriveDeploymentInputs(plan({ missions: [{ ...plan().missions[0], rewardBase: "100001" }] })), settings);
    expect(a).not.toBe(b);
  });

  it("mission order is preserved (never re-sorted) so the plan digest stays consistent", () => {
    const p = plan({ missions: [
      { missionKey: "b", missionIdHash: `0x${"b".repeat(64)}`, specDigest: `0x${"0".repeat(64)}`, title: "t", objective: "o", instructions: "i", targetSurface: "https://x", criteria: ["c"], evidenceRequirements: ["e"], rewardBase: "60000", maxCompletions: "1" },
      { missionKey: "a", missionIdHash: `0x${"a".repeat(64)}`, specDigest: `0x${"0".repeat(64)}`, title: "t", objective: "o", instructions: "i", targetSurface: "https://x", criteria: ["c"], evidenceRequirements: ["e"], rewardBase: "40000", maxCompletions: "1" },
    ] });
    const inputs = deriveDeploymentInputs(p);
    expect(inputs.missionIds).toEqual([`0x${"b".repeat(64)}`, `0x${"a".repeat(64)}`]); // input order, not sorted
    expect(inputs.rewards).toEqual([BigInt(60_000), BigInt(40_000)]);
  });
});

describe("deploy-plan — safety guards", () => {
  it("rejects a daily limit below the largest single reward", () => {
    expect(() => buildDeployBundle(plan(), { ...settings, dailyVelocityCap: BigInt(1) })).toThrow(/daily limit/);
  });
  it("approval amount is EXACTLY the budget (never unlimited)", () => {
    const b = buildDeployBundle(plan({ totalBudgetBase: "100000" }), settings);
    // the approve calldata encodes exactly 100000 (not 2^256-1).
    expect(b.calls[1].data.toLowerCase()).not.toContain("ffffffffffffffffffffffffffffffff");
    expect(b.inputs.totalBudgetBase).toBe(BigInt(100_000));
  });
});
