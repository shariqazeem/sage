import { describe, expect, it } from "vitest";
import { getAddress, type Hex } from "viem";
import { assemblePreview, faucetPolicy, assertFaucetAllowed, formatBase, type PreviewChainReads } from "./preview-core";
import { buildDeployBundle, type DeploymentSettings } from "./deploy-plan";
import type { DeploymentReadyPlan } from "./approve";

const FACTORY = getAddress("0x2249b773aFEd5594985F7D350581A1b55f279C7f");
const OWNER = getAddress("0xb77e6f5466cf52524e8465859277f192Be0bCfe4");
const OPERATOR = getAddress("0x7704E5BEe00Ef085dde85EEB0c49ae12d9F9BC35");
const TOKEN = getAddress("0xF176f521290A937d81cc5878dfc19908f4D681A1");
const CID = "0x4a5024d5af6dfe32e1ae40fb73978a8e1c793ef157109316ed2db31d868d10e7" as Hex;
const MID = "0x9af3313cb0b13822c9caaab12045888fbf36fcfa80ef85ddb76bb5b3c000c6f3" as Hex;

const settings: DeploymentSettings = {
  chainId: 59902, factory: FACTORY, owner: OWNER, operator: OPERATOR, guardian: OWNER, token: TOKEN,
  dailyVelocityCap: BigInt(100_000), durationSeconds: BigInt(604_800),
};
function plan(): DeploymentReadyPlan {
  return {
    schemaVersion: 1, publicCampaignId: "sage-metis-v2-ai-proof-1", campaignIdHash: CID,
    missionPlanDigest: "0x48f6d45295be7b0b4b85ab99846e5dec29408a7c101eeb63865abeef31d803d2" as Hex,
    tokenDecimals: 6, totalBudgetBase: "100000",
    missions: [{ missionKey: "verify", missionIdHash: MID, specDigest: `0x${"0".repeat(64)}` as Hex, title: "Verify HTTPS evidence", objective: "o", instructions: "i", targetSurface: "https://x", criteria: ["c"], evidenceRequirements: ["e"], rewardBase: "100000", maxCompletions: "1" }],
  };
}
const meta = { tokenDecimals: 6, missionPlanDigest: plan().missionPlanDigest, missionTitles: [{ title: "Verify HTTPS evidence", maxCompletions: "1" }] };

describe("preview-core — formatBase renders base units without float error", () => {
  it("formats 6-decimal amounts exactly", () => {
    expect(formatBase(BigInt(100_000), 6)).toBe("0.1");
    expect(formatBase(BigInt(6_000_000), 6)).toBe("6");
    expect(formatBase(BigInt(1_500_000), 6)).toBe("1.5");
    expect(formatBase(BigInt(0), 6)).toBe("0");
    expect(formatBase(BigInt(1), 6)).toBe("0.000001");
  });
});

describe("preview-core — the preview reflects the plan-bound bundle + chain reads", () => {
  const bundle = buildDeployBundle(plan(), settings);
  const reads = (over: Partial<PreviewChainReads> = {}): PreviewChainReads => ({
    founderBalanceBase: BigInt(500_000), predictedVaultCodeSize: 0, currentAllowanceBase: BigInt(0), ...over,
  });

  it("carries the exact predicted vault, hashes, and human budget from the bundle", () => {
    const p = assemblePreview(bundle, reads(), meta);
    expect(p.predictedVault).toBe(bundle.predictedVault);
    expect(p.calldataDigest).toBe(bundle.calldataDigest);
    expect(p.campaignIdHash).toBe(CID);
    expect(p.missionPlanDigest).toBe(plan().missionPlanDigest);
    expect(p.totalBudgetHuman).toBe("0.1");
    expect(p.steps.map((s) => s.step)).toEqual(["create", "approve", "fund", "activate"]);
    expect(p.approvalIsExact).toBe(true);
  });

  it("flags a wallet that cannot fund the budget (with the exact shortfall)", () => {
    const p = assemblePreview(bundle, reads({ founderBalanceBase: BigInt(40_000) }), meta);
    expect(p.sufficientBalance).toBe(false);
    expect(p.shortfallHuman).toBe("0.06"); // 100000 - 40000 = 60000 → 0.06
  });

  it("flags an already-existing vault so a resume attaches instead of redeploying", () => {
    const p = assemblePreview(bundle, reads({ predictedVaultCodeSize: 1234 }), meta);
    expect(p.vaultAlreadyExists).toBe(true);
  });

  it("needsApproval is false once an exact allowance already covers the budget", () => {
    expect(assemblePreview(bundle, reads({ currentAllowanceBase: BigInt(0) }), meta).needsApproval).toBe(true);
    expect(assemblePreview(bundle, reads({ currentAllowanceBase: BigInt(100_000) }), meta).needsApproval).toBe(false);
  });
});

describe("preview-core — the faucet is testnet-only (mainnet unreachable)", () => {
  const MOCK = "0xF176f521290A937d81cc5878dfc19908f4D681A1";
  it("is available on Metis Sepolia for the configured MockUSDC", () => {
    const p = faucetPolicy(59902, MOCK, MOCK);
    expect(p.available).toBe(true);
  });
  it("is UNAVAILABLE on any mainnet chain", () => {
    expect(faucetPolicy(2345, MOCK, MOCK).available).toBe(false); // GOAT mainnet
    expect(faucetPolicy(1088, MOCK, MOCK).available).toBe(false); // Metis Andromeda
    expect(faucetPolicy(1, MOCK, MOCK).available).toBe(false); // Ethereum
  });
  it("is unavailable for a token other than the configured MockUSDC", () => {
    expect(faucetPolicy(59902, "0xdeadbeef00000000000000000000000000000000", MOCK).available).toBe(false);
  });
  it("is unavailable when no faucet token is configured", () => {
    expect(faucetPolicy(59902, MOCK, null).available).toBe(false);
  });
  it("assertFaucetAllowed throws on a mainnet chain and returns the token on testnet", () => {
    expect(() => assertFaucetAllowed(2345, MOCK, MOCK)).toThrow(/faucet refused/);
    expect(assertFaucetAllowed(59902, MOCK, MOCK)).toBe(getAddress(MOCK));
  });
});
