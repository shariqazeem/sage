import { beforeAll, describe, expect, it } from "vitest";
import { decodeFunctionData, keccak256, parseAbi, toHex } from "viem";

import type { DeploymentReadyPlan } from "@/lib/launch/approve";
import type { LoadedPlan } from "@/lib/launch/deployment-service";
import { buildDeployBundle } from "@/lib/launch/deploy-plan";
import { settingsFor } from "@/lib/privy/deploy-runner";
import { prepareOwnWalletLaunch as prepare, type OwnWalletDeps } from "./flow";
import { realOwnWalletDeps as real } from "./server";

/**
 * THE BROWSER'S BUNDLE IS THE ACCOUNT'S BUNDLE. What a builder's own wallet is asked to sign is compared,
 * call for call, with what `launchFromTreasury` sends for the same plan: production's own settings builder
 * (`deploy-runner.settingsFor`) and bundle builder on one side, the own-wallet door's real dependencies on
 * the other. Same targets, same functions, same arguments, same order. The one thing that may differ is
 * who signs, and everything that follows from it (the vault's address, and its guardian).
 */

const FACTORY = "0xdD9a45c181dD95e48CDdC0149C8b821D604C45C9";
const OPERATOR = "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6";
const TOKEN = "0xEA32A96608495e54156Ae48931A7c20f0dcc1a21";
const BUILDER = "0x1111111111111111111111111111111111111111" as const;
const ACCOUNT = "0x3333333333333333333333333333333333333333" as const; // a Sage account (a wallet Sage signs for)
const FOUNDER = "0x4444444444444444444444444444444444444444" as const;

const ABI = parseAbi([
  "function createCampaignVault(address operator, address guardian, address token, bytes32 campaignIdHash, bytes32[] missionIds, uint256[] rewards, uint256[] maxCompletions, uint256 dailyVelocityCap, uint256 duration) returns (address)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function fund(uint256 amount)",
  "function activate()",
]);

const plan = {
  publicCampaignId: "parity-test",
  campaignIdHash: keccak256(toHex("parity-campaign")),
  totalBudgetBase: "20000000",
  tokenDecimals: 6,
  missions: [
    { missionIdHash: keccak256(toHex("parity-m1")), rewardBase: "2000000", maxCompletions: 5 },
    { missionIdHash: keccak256(toHex("parity-m2")), rewardBase: "1000000", maxCompletions: 10 },
  ],
} as unknown as DeploymentReadyPlan;
const loaded = { plan, revisionId: "rev", revisionNumber: 1, model: null, provider: null } as LoadedPlan;

// Read when a bundle is built, not when the modules load: the server's own settings for Metis.
beforeAll(() => {
  process.env.METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS = FACTORY;
  process.env.METIS_MAINNET_OPERATOR_ADDRESS = OPERATOR;
});

const treasuryBundle = (account: `0x${string}`, founder: `0x${string}`) =>
  buildDeployBundle(plan, settingsFor({ privyWalletAddress: account, founderAddress: founder, chainId: 1088 }, loaded));
const ownBundle = (owner: `0x${string}`) => {
  const s = real.settings(plan, owner);
  if (!s.ok) throw new Error(s.errors.join(","));
  return real.bundle(plan, s.settings);
};
const decode = (data: `0x${string}`) => decodeFunctionData({ abi: ABI, data });

describe("the own-wallet bundle equals the account launch's bundle", () => {
  it("is byte for byte the same when the same wallet signs", () => {
    const account = treasuryBundle(BUILDER, BUILDER);
    const own = ownBundle(BUILDER);
    expect(own.calls.map((c) => ({ step: c.step, to: c.to, data: c.data, value: c.value }))).toEqual(account.calls.map((c) => ({ step: c.step, to: c.to, data: c.data, value: c.value })));
    expect(own.predictedVault).toBe(account.predictedVault);
    expect(own.calldataDigest).toBe(account.calldataDigest);
    expect(own.settings).toEqual(account.settings);
  });

  it("is the same four calls in the same order: create, approve, fund, activate", () => {
    expect(ownBundle(BUILDER).calls.map((c) => c.step)).toEqual(["create", "approve", "fund", "activate"]);
    expect(treasuryBundle(ACCOUNT, FOUNDER).calls.map((c) => c.step)).toEqual(["create", "approve", "fund", "activate"]);
  });

  it("against a real account launch, differs only in who signs: same targets, same functions, same arguments", () => {
    const account = treasuryBundle(ACCOUNT, FOUNDER);
    const own = ownBundle(BUILDER);
    const [aCreate, aApprove, aFund, aActivate] = account.calls.map((c) => decode(c.data));
    const [oCreate, oApprove, oFund, oActivate] = own.calls.map((c) => decode(c.data));

    // the same functions (a decode against the named signature is a selector match)
    expect([oCreate, oApprove, oFund, oActivate].map((d) => d.functionName)).toEqual(["createCampaignVault", "approve", "fund", "activate"]);
    expect([aCreate, aApprove, aFund, aActivate].map((d) => d.functionName)).toEqual(["createCampaignVault", "approve", "fund", "activate"]);
    for (let i = 0; i < 4; i++) expect(own.calls[i].data.slice(0, 10)).toBe(account.calls[i].data.slice(0, 10));

    // create: the factory, with every argument equal except the guardian (the signer's own wallet)
    expect(own.calls[0].to).toBe(account.calls[0].to);
    expect(own.calls[0].to).toBe(FACTORY);
    const GUARDIAN = 1;
    const oArgs = [...(oCreate.args as readonly unknown[])];
    const aArgs = [...(aCreate.args as readonly unknown[])];
    expect(oArgs.filter((_, i) => i !== GUARDIAN)).toEqual(aArgs.filter((_, i) => i !== GUARDIAN));
    expect(oArgs[0]).toBe(OPERATOR); // Sage's Metis operator, from the server's settings
    expect(oArgs[2]).toBe(TOKEN);
    expect(oArgs[GUARDIAN]).toBe(BUILDER);
    expect(aArgs[GUARDIAN]).toBe(FOUNDER);

    // approve: the token, the EXACT budget, to each signer's own vault
    expect(own.calls[1].to).toBe(account.calls[1].to);
    expect(own.calls[1].to).toBe(TOKEN);
    expect(oApprove.args).toEqual([own.predictedVault, BigInt(20_000_000)]);
    expect(aApprove.args).toEqual([account.predictedVault, BigInt(20_000_000)]);

    // fund and activate: the signer's own vault, the same budget, nothing else
    expect(own.calls[2].to).toBe(own.predictedVault);
    expect(account.calls[2].to).toBe(account.predictedVault);
    expect(oFund.args).toEqual(aFund.args);
    expect(oFund.args).toEqual([BigInt(20_000_000)]);
    expect(own.calls[3].to).toBe(own.predictedVault);
    expect(oActivate.args ?? []).toEqual(aActivate.args ?? []);

    // the limits are the account launch's: the whole budget a day, fourteen days
    expect(own.settings.dailyVelocityCap).toBe(account.settings.dailyVelocityCap);
    expect(own.settings.durationSeconds).toBe(account.settings.durationSeconds);
    expect(own.settings.chainId).toBe(1088);
  });

  it("holds the budget invariant: Σ(reward × places) is the approved budget, exactly", () => {
    const b = ownBundle(BUILDER);
    expect(b.inputs.rewards.reduce((a, r, i) => a + r * b.inputs.maxCompletions[i], BigInt(0))).toBe(BigInt(plan.totalBudgetBase));
    const broken = { ...plan, totalBudgetBase: "20000001" } as unknown as DeploymentReadyPlan;
    const s = real.settings(broken, BUILDER);
    if (!s.ok) throw new Error(s.errors.join(","));
    expect(() => real.bundle(broken, s.settings)).toThrow(/do not sum to the approved budget/);
  });

  it("is what the door actually hands the browser", async () => {
    const deps: OwnWalletDeps = {
      ...real,
      job: () => ({ founderWallet: BUILDER }),
      isWeeklyRound: () => false,
      approvedPlan: () => loaded,
      liveCampaign: () => null,
      launchAllowed: () => ({ ok: true }),
      recordErrors: () => [],
      vaultState: async () => null,
    };
    const r = await prepare(BUILDER, "job", {}, deps);
    expect(r.ok && r.stage).toBe("ready");
    if (!r.ok || r.stage !== "ready") return;
    const account = treasuryBundle(BUILDER, BUILDER);
    expect(r.params.calls.map((c) => [c.step, c.to, c.data])).toEqual(account.calls.map((c) => [c.step, c.to, c.data]));
    expect(r.params.vault).toBe(account.predictedVault);
    expect(r.params.operator).toBe(OPERATOR);
    expect(r.params.token).toBe(TOKEN);
    expect(r.params.factory).toBe(FACTORY);
  });

  it("builds nothing for a wallet that is Sage's own operator", () => {
    const s = real.settings(plan, OPERATOR as `0x${string}`);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.errors).toContain("owner_equals_operator");
  });
});
