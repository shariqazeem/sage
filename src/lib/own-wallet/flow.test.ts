import { beforeEach, describe, expect, it } from "vitest";

import type { DeploymentReadyPlan } from "@/lib/launch/approve";
import type { DeployPlanBundle, DeploymentSettings } from "@/lib/launch/deploy-plan";
import type { LoadedPlan } from "@/lib/launch/deployment-service";
import { pausedNetworkReason } from "@/lib/deputy/networks";
import { prepareOwnWalletLaunch, recordOwnWalletLaunch, type OwnWalletDeps } from "./flow";
import type { ExpectedVault, VaultFacts } from "./plan";

/**
 * The own-wallet door's two decisions, against stand-ins for everything they touch. What is held here is
 * the ORDER (nothing is handed to a wallet before the network, the owner, the approval and the plan's
 * limits have each said yes) and that the record door believes the chain and nothing else.
 */

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x9999999999999999999999999999999999999999" as const;
const VAULT = "0x2222222222222222222222222222222222222222" as const;
const FACTORY = "0xdD9a45c181dD95e48CDdC0149C8b821D604C45C9" as const;
const TOKEN = "0xEA32A96608495e54156Ae48931A7c20f0dcc1a21" as const;
const OPERATOR = "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6" as const;
const CAMPAIGN = `0x${"ab".repeat(32)}` as const;
const M1 = `0x${"01".repeat(32)}` as const;
const BUDGET = BigInt(20_000_000);

const plan = {
  publicCampaignId: "test-abc",
  campaignIdHash: CAMPAIGN,
  totalBudgetBase: BUDGET.toString(),
  tokenDecimals: 6,
  missions: [{ missionIdHash: M1, rewardBase: "2000000", maxCompletions: 10 }],
} as unknown as DeploymentReadyPlan;
const loaded = { plan, revisionId: "rev_1", revisionNumber: 3, model: null, provider: null } as LoadedPlan;

const settings: DeploymentSettings = { chainId: 1088, factory: FACTORY, owner: OWNER, operator: OPERATOR, guardian: OWNER, token: TOKEN, dailyVelocityCap: BUDGET, durationSeconds: BigInt(14 * 86400) };
const bundle = (): DeployPlanBundle => ({
  settings,
  inputs: { campaignIdHash: CAMPAIGN, missionIds: [M1], rewards: [BigInt(2_000_000)], maxCompletions: [BigInt(10)], totalBudgetBase: BUDGET, largestRewardBase: BigInt(2_000_000) },
  predictedVault: VAULT,
  calldataDigest: "0x00",
  calls: [
    { step: "create", to: FACTORY, data: "0xc1", value: "0", label: "Create" },
    { step: "approve", to: TOKEN, data: "0xa1", value: "0", label: "Approve" },
    { step: "fund", to: VAULT, data: "0xf1", value: "0", label: "Fund" },
    { step: "activate", to: VAULT, data: "0xac", value: "0", label: "Activate" },
  ],
});

const goodFacts = (expected: ExpectedVault): VaultFacts => ({
  chainId: 1088,
  hasCode: true,
  factoryOwner: expected.owner,
  factoryCampaignVault: expected.vault,
  owner: expected.owner,
  operator: expected.operator,
  guardian: expected.guardian,
  token: expected.token,
  campaignIdHash: expected.campaignIdHash,
  budgetCeiling: expected.budgetBase,
  dailyVelocityCap: expected.dailyVelocityCap,
  durationSeconds: expected.durationSeconds,
  state: "active",
  balanceBase: expected.budgetBase,
  totalSpentBase: BigInt(0),
  missionCount: expected.missions.length,
  missions: Object.fromEntries(expected.missions.map((m) => [m.missionIdHash.toLowerCase(), { exists: true, rewardBase: m.rewardBase, maxCompletions: m.maxCompletions }])),
});

let log: string[];
let approved: boolean;
let live: { id: string; vaultAddress: string; posterWallet: string } | null;

function deps(over: Partial<OwnWalletDeps> = {}): OwnWalletDeps {
  const say = <T,>(name: string, value: T): T => {
    log.push(name);
    return value;
  };
  return {
    // the real policy's words for a paused or closed network; Metis is open
    closedReason: (chainId) => say(`closedReason:${chainId}`, chainId === 1088 ? null : (pausedNetworkReason(chainId) ?? `Sage doesn't launch on chain ${chainId}.`)),
    job: () => say("job", { founderWallet: OWNER }),
    isWeeklyRound: () => say("isWeeklyRound", false),
    currentRevision: () => say("currentRevision", 3),
    approve: () => {
      approved = true;
      return say("approve", true);
    },
    approvedPlan: () => say("approvedPlan", approved ? loaded : null),
    draftPlan: () => say("draftPlan", plan),
    launchAllowed: () => say("launchAllowed", { ok: true as const }),
    launchSafety: () => say("launchSafety", { ok: true as const }),
    settings: () => say("settings", { ok: true as const, settings }),
    bundle: () => say("bundle", bundle()),
    recordErrors: () => say("recordErrors", []),
    liveCampaign: () => say("liveCampaign", live),
    vaultState: async () => say("vaultState", null),
    facts: async (expected) => say("facts", goodFacts(expected)),
    record: async () => {
      live = { id: "test-abc", vaultAddress: VAULT, posterWallet: OWNER };
      return say("record", "test-abc");
    },
    ...over,
  };
}

beforeEach(() => {
  log = [];
  approved = false;
  live = null;
});

describe("prepare: what the wallet may sign", () => {
  it("hands over the four calls, in order, once the plan is approved", async () => {
    const r = await prepareOwnWalletLaunch(OWNER, "job1", { approve: true, expectedRevision: 3 }, deps());
    expect(r.ok && r.stage).toBe("ready");
    if (!r.ok || r.stage !== "ready") return;
    expect(r.params.calls.map((c) => c.step)).toEqual(["create", "approve", "fund", "activate"]);
    expect(r.params.calls.map((c) => [c.to, c.data])).toEqual(bundle().calls.map((c) => [c.to, c.data]));
    expect(r.params).toMatchObject({ chainId: 1088, owner: OWNER, vault: VAULT, factory: FACTORY, token: TOKEN, operator: OPERATOR, budgetBase: "20000000", tokenDecimals: 6 });
  });

  it("runs the account launch's checks in its order, and the plan's limits before any call is handed over", async () => {
    await prepareOwnWalletLaunch(OWNER, "job1", { approve: true }, deps());
    const at = (name: string) => log.indexOf(name);
    expect(at("closedReason:1088")).toBe(0);
    expect(at("job")).toBeGreaterThan(at("closedReason:1088"));
    expect(at("approve")).toBeGreaterThan(at("job"));
    expect(at("launchAllowed")).toBeGreaterThan(at("approve"));
    expect(at("recordErrors")).toBeGreaterThan(at("launchAllowed"));
    expect(log).not.toContain("record");
    expect(log).not.toContain("facts");
  });

  it("LAUNCH ALLOWED BEFORE MONEY MOVES: a plan limit refuses with no calls and nothing recorded", async () => {
    const r = await prepareOwnWalletLaunch(OWNER, "job1", { approve: true }, deps({ launchAllowed: () => ({ ok: false, message: "Free launches one job at a time.", upgradeTo: "pro" }) }));
    expect(r).toEqual({ ok: false, reason: "plan_limit", message: "Free launches one job at a time.", upgradeTo: "pro" });
    expect(JSON.stringify(r)).not.toContain("0xc1");
  });

  it("THE PRODUCT IS ASKED BEFORE MONEY MOVES: a refused product gets the plain reason, no calls, nothing recorded", async () => {
    const r = await prepareOwnWalletLaunch(OWNER, "job1", { approve: true }, deps({ launchSafety: () => ({ ok: false, message: "Sage can't run a test here. Nothing was sent." }) }));
    expect(r).toMatchObject({ ok: false, reason: "not_ready", message: "Sage can't run a test here. Nothing was sent." });
    expect(JSON.stringify(r)).not.toContain("0xc1");
    expect(log).not.toContain("record");
  });

  it("never asks about the product again once the wallet's money is in the vault (a live test keeps going)", async () => {
    for (const s of ["funded", "active"] as const) {
      log = [];
      const r = await prepareOwnWalletLaunch(OWNER, "job1", { approve: true }, deps({ vaultState: async () => s, launchSafety: () => ({ ok: false, message: "no" }) }));
      expect(r.ok).toBe(true);
    }
  });

  it("checks the plan's limits on a vault that is only created (nothing has moved yet)", async () => {
    await prepareOwnWalletLaunch(OWNER, "job1", { approve: true }, deps({ vaultState: async () => "created" }));
    expect(log).toContain("launchAllowed");
  });

  it("never asks the plan again once the wallet's money is in the vault", async () => {
    for (const s of ["funded", "active"] as const) {
      log = [];
      const r = await prepareOwnWalletLaunch(OWNER, "job1", { approve: true }, deps({ vaultState: async () => s, launchAllowed: () => ({ ok: false, message: "no" }) }));
      expect(r.ok).toBe(true);
    }
  });

  it("still checks the plan when the chain can't be read", async () => {
    const r = await prepareOwnWalletLaunch(OWNER, "job1", { approve: true }, deps({ vaultState: async () => { throw new Error("rpc"); }, launchAllowed: () => ({ ok: false, message: "no" }) }));
    expect(r).toMatchObject({ ok: false, reason: "plan_limit" });
  });

  it("refuses a paused network (GOAT) and a closed one (Arc, Starknet) with that network's own sentence", async () => {
    for (const chainId of [2345, 5042, 900001]) {
      log = [];
      const r = await prepareOwnWalletLaunch(OWNER, "job1", { approve: true, chainId }, deps());
      expect(r).toEqual({ ok: false, reason: "network_paused", message: pausedNetworkReason(chainId) });
      expect(pausedNetworkReason(chainId)).toBeTruthy();
      expect(log).toEqual([`closedReason:${chainId}`]); // nothing else was even looked at
    }
  });

  it("refuses every chain that isn't Metis, open or not", async () => {
    const r = await prepareOwnWalletLaunch(OWNER, "job1", { approve: true, chainId: 1 }, deps({ closedReason: () => null }));
    expect(r).toMatchObject({ ok: false, reason: "network_paused", message: "Paying from your own wallet runs on Metis only." });
  });

  it("refuses when Metis itself is paused or unconfigured, before anything else", async () => {
    const r = await prepareOwnWalletLaunch(OWNER, "job1", { approve: true }, deps({ closedReason: () => "Sage is opening on Metis." }));
    expect(r).toEqual({ ok: false, reason: "network_paused", message: "Sage is opening on Metis." });
    expect(log).toEqual([]);
  });

  it("refuses settings built for a closed chain", async () => {
    const r = await prepareOwnWalletLaunch(OWNER, "job1", { approve: true }, deps({ settings: () => ({ ok: false, errors: ["chain_closed:1088"] }) }));
    expect(r).toMatchObject({ ok: false, reason: "network_paused" });
    const elsewhere = await prepareOwnWalletLaunch(OWNER, "job1", { approve: true }, deps({ settings: () => ({ ok: true, settings: { ...settings, chainId: 2345 } }) }));
    expect(elsewhere).toMatchObject({ ok: false, reason: "network_paused" });
  });

  it("refuses a plan that belongs to someone else, and a Starknet session", async () => {
    expect(await prepareOwnWalletLaunch(OTHER, "job1", { approve: true }, deps())).toMatchObject({ ok: false, reason: "not_yours" });
    expect(log).not.toContain("approve");
    const felt = "0x5db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";
    expect(await prepareOwnWalletLaunch(felt, "job1", { approve: true }, deps({ job: () => ({ founderWallet: felt }) }))).toMatchObject({ ok: false, reason: "not_evm" });
  });

  it("matches the owner by sameFounder, not by spelling", async () => {
    const r = await prepareOwnWalletLaunch(OWNER, "job1", { approve: true }, deps({ job: () => ({ founderWallet: OWNER.toUpperCase().replace("0X", "0x") }) }));
    expect(r.ok).toBe(true);
  });

  it("refuses a weekly round: Sage opens each next round from the account", async () => {
    expect(await prepareOwnWalletLaunch(OWNER, "job1", { approve: true }, deps({ isWeeklyRound: () => true }))).toMatchObject({ ok: false, reason: "weekly_round" });
  });

  it("refuses to approve a revision other than the one on screen", async () => {
    const r = await prepareOwnWalletLaunch(OWNER, "job1", { approve: true, expectedRevision: 2 }, deps());
    expect(r).toMatchObject({ ok: false, reason: "plan_changed" });
    expect(log).not.toContain("approve");
  });

  it("refuses when the approval does not go through", async () => {
    expect(await prepareOwnWalletLaunch(OWNER, "job1", { approve: true }, deps({ approve: () => false }))).toMatchObject({ ok: false, reason: "not_ready" });
  });

  it("without an approval it answers the budget and the vault, and NO calls", async () => {
    const r = await prepareOwnWalletLaunch(OWNER, "job1", {}, deps());
    expect(r.ok && r.stage).toBe("preview");
    if (!r.ok || r.stage !== "preview") return;
    expect(r.params.calls).toEqual([]);
    expect(r.params.budgetBase).toBe("20000000");
    expect(r.params.vault).toBe(VAULT);
    expect(log).not.toContain("approve");
    expect(log).toContain("launchAllowed"); // a refusal is known before the button is pressed
  });

  it("THE INVARIANT: refuses a plan whose rewards do not add up to its budget", async () => {
    const off = { ...plan, totalBudgetBase: (BUDGET + BigInt(1)).toString() } as unknown as DeploymentReadyPlan;
    approved = true;
    const r = await prepareOwnWalletLaunch(OWNER, "job1", {}, deps({ approvedPlan: () => ({ ...loaded, plan: off }) }));
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
    expect(log).not.toContain("bundle");
  });

  it("refuses a bundle that is not exactly the four launch calls", async () => {
    const withFee = (): DeployPlanBundle => ({ ...bundle(), calls: [...bundle().calls, { step: "fee", to: OTHER, data: "0xfe", value: "0", label: "Fee" }] });
    expect(await prepareOwnWalletLaunch(OWNER, "job1", { approve: true }, deps({ bundle: withFee }))).toMatchObject({ ok: false, reason: "invalid" });
    const reordered = (): DeployPlanBundle => ({ ...bundle(), calls: [bundle().calls[1], bundle().calls[0], bundle().calls[2], bundle().calls[3]] });
    expect(await prepareOwnWalletLaunch(OWNER, "job1", { approve: true }, deps({ bundle: reordered }))).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("refuses, with nothing signed, a plan that could not be recorded afterwards", async () => {
    const r = await prepareOwnWalletLaunch(OWNER, "job1", { approve: true }, deps({ recordErrors: () => ["too_many_missions"] }));
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
    expect(r.ok ? "" : r.message).toMatch(/too_many_missions/);
  });

  it("answers live, with nothing to sign, for a job already recorded", async () => {
    approved = true;
    live = { id: "test-abc", vaultAddress: VAULT, posterWallet: OWNER };
    expect(await prepareOwnWalletLaunch(OWNER, "job1", { approve: true }, deps())).toEqual({ ok: true, stage: "live", campaignId: "test-abc" });
    expect(log).not.toContain("launchAllowed");
  });
});

describe("record: the chain decides", () => {
  beforeEach(() => {
    approved = true;
  });

  it("records a vault the chain shows to be this plan's, through the account launch's recorder", async () => {
    const r = await recordOwnWalletLaunch(OWNER, "job1", { vault: VAULT }, deps());
    expect(r).toEqual({ ok: true, campaignId: "test-abc", vault: VAULT });
    expect(log.indexOf("facts")).toBeLessThan(log.indexOf("record"));
  });

  it("NEVER runs the plan check here: the wallet's money may already be in the vault", async () => {
    await recordOwnWalletLaunch(OWNER, "job1", {}, deps({ launchAllowed: () => { throw new Error("launchAllowed must not run at the record door"); } }));
    expect(log).not.toContain("launchAllowed");
    expect(log).toContain("record");
  });

  it("works from the server's own vault address when the client names none", async () => {
    let asked: ExpectedVault | null = null;
    await recordOwnWalletLaunch(OWNER, "job1", {}, deps({ facts: async (e) => { asked = e; return goodFacts(e); } }));
    expect(asked).toMatchObject({ vault: VAULT, owner: OWNER, operator: OPERATOR, token: TOKEN, factory: FACTORY, budgetBase: BUDGET, dailyVelocityCap: BUDGET, campaignIdHash: CAMPAIGN });
  });

  it("refuses a vault the client names that is not this wallet's vault for this plan", async () => {
    const r = await recordOwnWalletLaunch(OWNER, "job1", { vault: OTHER }, deps());
    expect(r).toMatchObject({ ok: false, reason: "wrong_vault" });
    expect(log).not.toContain("facts");
    expect(log).not.toContain("record");
  });

  const tamper: [string, (f: VaultFacts) => VaultFacts, string][] = [
    ["a different operator", (f) => ({ ...f, operator: OTHER }), "operator"],
    ["a different token", (f) => ({ ...f, token: OTHER }), "token"],
    ["a different budget", (f) => ({ ...f, budgetCeiling: f.budgetCeiling * BigInt(2) }), "budget"],
    ["a different reward", (f) => ({ ...f, missions: { [M1]: { exists: true, rewardBase: BigInt(1), maxCompletions: BigInt(10) } } }), "mission_reward"],
    ["different places", (f) => ({ ...f, missions: { [M1]: { exists: true, rewardBase: BigInt(2_000_000), maxCompletions: BigInt(99) } } }), "mission_places"],
    ["a different daily cap", (f) => ({ ...f, dailyVelocityCap: BigInt(1) }), "daily_cap"],
    ["no funding", (f) => ({ ...f, balanceBase: BigInt(0) }), "underfunded"],
    ["no activation", (f) => ({ ...f, state: "funded" as const, durationSeconds: null }), "not_active"],
    ["another funder", (f) => ({ ...f, owner: OTHER, factoryOwner: OTHER }), "funder_not_you"],
    ["no factory behind it", (f) => ({ ...f, factoryOwner: "0x0000000000000000000000000000000000000000" }), "not_from_factory"],
    ["nothing deployed", (f) => ({ ...f, hasCode: false }), "no_vault"],
  ];
  it.each(tamper)("refuses a vault with %s, and records nothing", async (_n, change, mismatch) => {
    const r = await recordOwnWalletLaunch(OWNER, "job1", { vault: VAULT }, deps({ facts: async (e) => change(goodFacts(e)) }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("mismatch");
    expect(r.mismatches).toContain(mismatch);
    expect(log).not.toContain("record");
    expect(live).toBeNull();
  });

  it("refuses someone else's plan, an unapproved plan, and a paused or closed network", async () => {
    expect(await recordOwnWalletLaunch(OTHER, "job1", {}, deps())).toMatchObject({ ok: false, reason: "not_yours" });
    approved = false;
    expect(await recordOwnWalletLaunch(OWNER, "job1", {}, deps())).toMatchObject({ ok: false, reason: "not_ready" });
    approved = true;
    for (const chainId of [2345, 5042, 900001]) {
      expect(await recordOwnWalletLaunch(OWNER, "job1", { chainId }, deps())).toEqual({ ok: false, reason: "network_paused", message: pausedNetworkReason(chainId) });
    }
    expect(log).not.toContain("record");
  });

  it("says so, and records nothing, when the chain can't be read", async () => {
    const r = await recordOwnWalletLaunch(OWNER, "job1", {}, deps({ facts: async () => { throw new Error("rpc down"); } }));
    expect(r).toMatchObject({ ok: false, reason: "unreadable" });
    expect(log).not.toContain("record");
  });

  it("answers the same for a job already recorded, without recording twice", async () => {
    live = { id: "test-abc", vaultAddress: VAULT.toUpperCase().replace("0X", "0x"), posterWallet: OWNER };
    expect(await recordOwnWalletLaunch(OWNER, "job1", {}, deps())).toEqual({ ok: true, campaignId: "test-abc", vault: VAULT });
    expect(log).not.toContain("record");
    expect(log).not.toContain("facts");
  });

  it("refuses a plan already live from another wallet", async () => {
    live = { id: "test-abc", vaultAddress: OTHER, posterWallet: OTHER };
    expect(await recordOwnWalletLaunch(OWNER, "job1", {}, deps())).toMatchObject({ ok: false, reason: "taken" });
  });

  it("two tabs finishing at once: the loser answers with the winner's record", async () => {
    const r = await recordOwnWalletLaunch(OWNER, "job1", {}, deps({
      record: async () => {
        live = { id: "test-abc", vaultAddress: VAULT, posterWallet: OWNER };
        throw new Error("UNIQUE constraint failed: campaigns.id");
      },
    }));
    expect(r).toEqual({ ok: true, campaignId: "test-abc", vault: VAULT });
  });

  it("reports a recorder failure with the vault's safety stated, when nothing was recorded", async () => {
    const r = await recordOwnWalletLaunch(OWNER, "job1", {}, deps({ record: async () => { throw new Error("the vault deployed + funded, but recording it failed (agreement): operator_mismatch"); } }));
    expect(r).toMatchObject({ ok: false, reason: "failed" });
    expect(r.ok ? "" : r.message).toMatch(/operator_mismatch/);
  });
});
