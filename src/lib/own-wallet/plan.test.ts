import { describe, expect, it } from "vitest";

import { launchStepsFeeWei, minLaunchGasWei, needsFeeMessage } from "@/lib/treasury/gas-policy";
import {
  legacyRpcTx,
  legacyTx,
  metisAddChainParams,
  ownWalletProgress,
  ownWalletShortfalls,
  vaultRefusal,
  verifyOwnWalletVault,
  type ExpectedVault,
  type OwnWalletChainState,
  type VaultFacts,
  type VaultMismatch,
} from "./plan";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const VAULT = "0x2222222222222222222222222222222222222222" as const;
const FACTORY = "0xdD9a45c181dD95e48CDdC0149C8b821D604C45C9" as const;
const TOKEN = "0xEA32A96608495e54156Ae48931A7c20f0dcc1a21" as const;
const OPERATOR = "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6" as const;
const CAMPAIGN = `0x${"ab".repeat(32)}`;
const M1 = `0x${"01".repeat(32)}`;
const M2 = `0x${"02".repeat(32)}`;
const BUDGET = BigInt(20_000_000); // $20.00
const GWEI = BigInt(1_000_000_000);

const state = (over: Partial<OwnWalletChainState> = {}): OwnWalletChainState => ({
  vaultExists: false,
  vaultState: null,
  allowanceBase: BigInt(0),
  usdcBase: BUDGET,
  nativeWei: BigInt("100000000000000000"), // 0.1 METIS
  gasPriceWei: BigInt(16) * GWEI,
  ...over,
});

describe("every transaction on Metis is type 0", () => {
  const call = { to: FACTORY, data: "0xdeadbeef" as const };

  it("shapes a call as legacy, with a gas price and a gas limit, each with 20% headroom", () => {
    const tx = legacyTx({ chainId: 1088, from: OWNER, call, gasEstimate: BigInt(1_000_000), gasPriceWei: BigInt(10) * GWEI });
    expect(tx).toEqual({ type: "legacy", chainId: 1088, from: OWNER, to: FACTORY, data: "0xdeadbeef", value: BigInt(0), gas: BigInt(1_200_000), gasPrice: BigInt(12) * GWEI });
  });

  it("hands a wallet type 0x0 and gasPrice, and never an EIP-1559 field", () => {
    const rpc = legacyRpcTx(legacyTx({ chainId: 1088, from: OWNER, call, gasEstimate: BigInt(50_000), gasPriceWei: GWEI }));
    expect(rpc.type).toBe("0x0");
    expect(rpc.gasPrice).toBe(`0x${(BigInt(12) * (GWEI / BigInt(10))).toString(16)}`);
    expect(rpc.gas).toBe(`0x${BigInt(60_000).toString(16)}`);
    expect(rpc.value).toBe("0x0");
    expect(Object.keys(rpc)).not.toContain("maxFeePerGas");
    expect(Object.keys(rpc)).not.toContain("maxPriorityFeePerGas");
    expect(Object.keys(rpc)).not.toContain("nonce"); // the wallet numbers it, unless this page signs the bytes itself
    expect(legacyRpcTx(legacyTx({ chainId: 1088, from: OWNER, call, gasEstimate: BigInt(1), gasPriceWei: BigInt(1) }), 7).nonce).toBe("0x7");
  });

  it("refuses to shape a transaction for any other network", () => {
    for (const chainId of [2345, 5042, 59902, 1]) {
      expect(() => legacyTx({ chainId, from: OWNER, call, gasEstimate: BigInt(1), gasPriceWei: BigInt(1) })).toThrow(/Metis only/);
    }
  });

  it("refuses a transaction with no estimate or no price", () => {
    expect(() => legacyTx({ chainId: 1088, from: OWNER, call, gasEstimate: BigInt(0), gasPriceWei: GWEI })).toThrow();
    expect(() => legacyTx({ chainId: 1088, from: OWNER, call, gasEstimate: BigInt(1), gasPriceWei: BigInt(0) })).toThrow();
  });

  it("teaches a wallet Metis with the network's real parameters", () => {
    expect(metisAddChainParams()).toEqual({
      chainId: "0x440",
      chainName: "Metis Andromeda",
      nativeCurrency: { name: "Metis", symbol: "METIS", decimals: 18 },
      rpcUrls: ["https://andromeda.metis.io/?owner=1088"],
      blockExplorerUrls: ["https://andromeda-explorer.metis.io"],
    });
  });
});

describe("resume from the chain", () => {
  it("starts with create when there is no vault", () => {
    expect(ownWalletProgress(state(), BUDGET)).toEqual({ kind: "next", step: "create", done: [], remaining: ["create", "approve", "fund", "activate"] });
  });

  it("goes to approve once the vault exists", () => {
    expect(ownWalletProgress(state({ vaultExists: true, vaultState: "created" }), BUDGET)).toMatchObject({ step: "approve", done: ["create"] });
  });

  it("goes to fund once the allowance covers the budget", () => {
    expect(ownWalletProgress(state({ vaultExists: true, vaultState: "created", allowanceBase: BUDGET }), BUDGET)).toMatchObject({ step: "fund", done: ["create", "approve"] });
    // an allowance one unit short is not an approval
    expect(ownWalletProgress(state({ vaultExists: true, vaultState: "created", allowanceBase: BUDGET - BigInt(1) }), BUDGET)).toMatchObject({ step: "approve" });
  });

  it("NEVER funds a funded vault again, whatever the allowance says", () => {
    for (const allowanceBase of [BigInt(0), BUDGET, BUDGET * BigInt(5)]) {
      const p = ownWalletProgress(state({ vaultExists: true, vaultState: "funded", allowanceBase }), BUDGET);
      expect(p).toEqual({ kind: "next", step: "activate", done: ["create", "approve", "fund"], remaining: ["activate"] });
    }
  });

  it("has nothing left to send once the vault is active", () => {
    expect(ownWalletProgress(state({ vaultExists: true, vaultState: "active" }), BUDGET)).toEqual({ kind: "complete", done: ["create", "approve", "fund", "activate"] });
  });

  it("stops, sending nothing, on a vault that is revoked, paused or unreadable", () => {
    for (const vaultState of ["revoked", "paused", null] as const) {
      expect(ownWalletProgress(state({ vaultExists: true, vaultState }), BUDGET).kind).toBe("stopped");
    }
  });
});

describe("short of something: what, by how much, and where to get it", () => {
  const all = ["create", "approve", "fund", "activate"] as const;
  const ask = (s: OwnWalletChainState, remaining: readonly ("create" | "approve" | "fund" | "activate")[] = all) =>
    ownWalletShortfalls({ owner: OWNER, budgetBase: BUDGET, token: TOKEN, tokenSymbol: "m.USDC", state: s, remaining });

  it("says nothing when the wallet holds the budget and the fee", () => {
    expect(ask(state())).toEqual([]);
  });

  it("names the exact m.USDC missing, the wallet and the network", () => {
    const [s] = ask(state({ usdcBase: BigInt(12_500_000) }));
    expect(s.what).toBe("usdc");
    expect(s.missing).toBe(BigInt(7_500_000));
    expect(s.message).toBe(
      `Your wallet holds 12.50 m.USDC on Metis and this test needs 20.00. Add 7.50 m.USDC to 0x1111…1111 on the Metis network (the token is ${TOKEN}).`,
    );
  });

  it("asks a whole launch for the chain's launch floor, in the fee door's own words, addressed to the wallet", () => {
    const have = BigInt("10000000000000000"); // 0.01 METIS
    const [s] = ask(state({ nativeWei: have }));
    expect(s.what).toBe("fee");
    expect(s.missing).toBe(minLaunchGasWei(1088) - have);
    expect(s.message).toBe(needsFeeMessage({ chainId: 1088, action: "launch", needWei: minLaunchGasWei(1088), haveWei: have, nativeSymbol: "METIS", network: "Metis", holder: "wallet" }));
    expect(s.message).toMatch(/^Your wallet needs about 0\.05 METIS for the network fee to launch this job, and it holds 0\.01\./);
    expect(s.message).toMatch(/withdraw METIS on the Metis network from Binance, OKX/);
    expect(s.message).not.toMatch(/Swap a little USDC/); // that door is the Sage account's, not a wallet's
  });

  it("reports both when both are short", () => {
    expect(ask(state({ usdcBase: BigInt(0), nativeWei: BigInt(0) })).map((s) => s.what)).toEqual(["usdc", "fee"]);
  });

  it("asks a resumed launch only for the steps still to send, and no budget once it is funded", () => {
    // funded: only activate is left, so a wallet with no m.USDC and a sliver of METIS can finish
    const sliver = BigInt("3000000000000000"); // 0.003 METIS
    expect(ask(state({ usdcBase: BigInt(0), nativeWei: sliver }), ["activate"])).toEqual([]);
    const need = launchStepsFeeWei(1088, ["activate"], BigInt(16) * GWEI);
    expect(need).toBe(BigInt(90_000) * ((BigInt(16) * GWEI * BigInt(12)) / BigInt(10)));
    expect(need < minLaunchGasWei(1088)).toBe(true);
    expect(ask(state({ nativeWei: need - BigInt(1) }), ["activate"])[0].missing).toBe(BigInt(1));
  });

  it("sizes the fee from the per-chain policy: the floor for a whole launch, never more than it for the rest", () => {
    expect(launchStepsFeeWei(1088, all, BigInt(16) * GWEI)).toBe(minLaunchGasWei(1088));
    expect(launchStepsFeeWei(1088, ["approve", "fund", "activate"], null)).toBe(minLaunchGasWei(1088));
    expect(launchStepsFeeWei(1088, ["approve", "fund", "activate"], BigInt(1_000_000) * GWEI)).toBe(minLaunchGasWei(1088));
    expect(launchStepsFeeWei(1088, [], BigInt(16) * GWEI)).toBe(BigInt(0));
  });

  it("leaves the account's own sentence exactly as it was", () => {
    expect(needsFeeMessage({ chainId: 1088, action: "launch", needWei: minLaunchGasWei(1088), haveWei: BigInt(0), nativeSymbol: "METIS", network: "Metis" })).toMatch(/^Your account needs about 0\.05 METIS/);
  });
});

describe("the record door's judgment of a vault", () => {
  const expected: ExpectedVault = {
    chainId: 1088,
    owner: OWNER,
    vault: VAULT,
    factory: FACTORY,
    operator: OPERATOR,
    guardian: OWNER,
    token: TOKEN,
    campaignIdHash: CAMPAIGN,
    budgetBase: BUDGET,
    dailyVelocityCap: BUDGET,
    durationSeconds: BigInt(14 * 86400),
    missions: [
      { missionIdHash: M1, rewardBase: BigInt(2_000_000), maxCompletions: BigInt(5) },
      { missionIdHash: M2, rewardBase: BigInt(1_000_000), maxCompletions: BigInt(10) },
    ],
  };
  const facts = (over: Partial<VaultFacts> = {}): VaultFacts => ({
    chainId: 1088,
    hasCode: true,
    factoryOwner: OWNER.toUpperCase().replace("0X", "0x"),
    factoryCampaignVault: VAULT,
    owner: OWNER,
    operator: OPERATOR,
    guardian: OWNER,
    token: TOKEN,
    campaignIdHash: CAMPAIGN.toUpperCase().replace("0X", "0x"),
    budgetCeiling: BUDGET,
    dailyVelocityCap: BUDGET,
    durationSeconds: BigInt(14 * 86400),
    state: "active",
    balanceBase: BUDGET,
    totalSpentBase: BigInt(0),
    missionCount: 2,
    missions: {
      [M1]: { exists: true, rewardBase: BigInt(2_000_000), maxCompletions: BigInt(5) },
      [M2]: { exists: true, rewardBase: BigInt(1_000_000), maxCompletions: BigInt(10) },
    },
    ...over,
  });
  const STRANGER = "0x9999999999999999999999999999999999999999";
  const ZERO = "0x0000000000000000000000000000000000000000";

  it("accepts the vault the plan compiles to, however its addresses are spelled", () => {
    expect(verifyOwnWalletVault(expected, facts())).toEqual({ ok: true });
  });

  it("accepts a vault that has already paid someone, as long as the budget was all there", () => {
    expect(verifyOwnWalletVault(expected, facts({ balanceBase: BUDGET - BigInt(2_000_000), totalSpentBase: BigInt(2_000_000) }))).toEqual({ ok: true });
  });

  const tampered: [string, Partial<VaultFacts>, VaultMismatch][] = [
    ["no contract at the address", { hasCode: false }, "no_vault"],
    ["another chain", { chainId: 2345 }, "wrong_chain"],
    ["not created by Sage's factory", { factoryOwner: ZERO }, "not_from_factory"],
    ["the factory holds a different vault for this job", { factoryCampaignVault: STRANGER }, "not_this_campaign"],
    ["the factory says someone else created it", { factoryOwner: STRANGER }, "funder_not_you"],
    ["owned (so funded) by another wallet", { owner: STRANGER }, "funder_not_you"],
    ["a different operator", { operator: STRANGER }, "operator"],
    ["the owner as its own operator", { operator: OWNER }, "operator"],
    ["a different guardian", { guardian: STRANGER }, "guardian"],
    ["a different token", { token: STRANGER }, "token"],
    ["a different campaign id", { campaignIdHash: `0x${"cd".repeat(32)}` }, "campaign_id"],
    ["a larger budget", { budgetCeiling: BUDGET + BigInt(1) }, "budget"],
    ["a smaller budget", { budgetCeiling: BUDGET - BigInt(1) }, "budget"],
    ["a different daily cap", { dailyVelocityCap: BUDGET / BigInt(2) }, "daily_cap"],
    ["a different duration", { durationSeconds: BigInt(86400) }, "duration"],
    ["an extra mission", { missionCount: 3 }, "mission_count"],
    ["a missing mission", { missions: { [M1]: { exists: true, rewardBase: BigInt(2_000_000), maxCompletions: BigInt(5) } } }, "mission_missing"],
    ["a mission that does not exist on chain", { missions: { [M1]: { exists: true, rewardBase: BigInt(2_000_000), maxCompletions: BigInt(5) }, [M2]: { exists: false, rewardBase: BigInt(0), maxCompletions: BigInt(0) } } }, "mission_missing"],
    ["a different reward", { missions: { [M1]: { exists: true, rewardBase: BigInt(2_000_001), maxCompletions: BigInt(5) }, [M2]: { exists: true, rewardBase: BigInt(1_000_000), maxCompletions: BigInt(10) } } }, "mission_reward"],
    ["different places", { missions: { [M1]: { exists: true, rewardBase: BigInt(2_000_000), maxCompletions: BigInt(6) }, [M2]: { exists: true, rewardBase: BigInt(1_000_000), maxCompletions: BigInt(10) } } }, "mission_places"],
    ["underfunded by one unit", { balanceBase: BUDGET - BigInt(1) }, "underfunded"],
    ["empty", { balanceBase: BigInt(0) }, "underfunded"],
    ["funded but not activated", { state: "funded", durationSeconds: null }, "not_active"],
    ["created only", { state: "created", durationSeconds: null, balanceBase: BigInt(0) }, "not_active"],
    ["paused", { state: "paused" }, "not_active"],
    ["revoked", { state: "revoked" }, "not_active"],
  ];
  it.each(tampered)("refuses a vault with %s", (_name, over, mismatch) => {
    const r = verifyOwnWalletVault(expected, facts(over));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mismatches).toContain(mismatch);
  });

  it("refuses a plan whose rewards do not add up to its budget, even when the vault matches it", () => {
    const off = { ...expected, budgetBase: BUDGET + BigInt(1) };
    const r = verifyOwnWalletVault(off, facts({ budgetCeiling: BUDGET + BigInt(1), balanceBase: BUDGET + BigInt(1) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mismatches).toContain("budget");
  });

  it("names everything that is wrong, and says nothing was recorded", () => {
    const r = verifyOwnWalletVault(expected, facts({ operator: STRANGER, balanceBase: BigInt(0) }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect([...r.mismatches].sort()).toEqual(["operator", "underfunded"]);
    const words = vaultRefusal(r.mismatches);
    expect(words).toMatch(/its operator is not Sage's Metis operator/);
    expect(words).toMatch(/it does not hold the whole budget/);
    expect(words).toMatch(/Nothing was recorded/);
  });
});
