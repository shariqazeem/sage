import { afterEach, describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";

import {
  attachV2Campaign,
  computeV2SetupPreview,
  setupAllowed,
  type V2SetupInput,
} from "./v2-setup";
import { getCampaign, listMissions } from "@/lib/db/campaigns";
import type { ChainCampaignSnapshot } from "./vault-agreement";
import type { CampaignVaultAdapter } from "@/lib/deputy/campaign-vault";

const FOUNDER = getAddress("0xb77e6f5466cf52524e8465859277f192Be0bCfe4");
const OPERATOR = getAddress("0x7704E5BEe00Ef085dde85EEB0c49ae12d9F9BC35");
const TOKEN = getAddress("0xF176f521290A937d81cc5878dfc19908f4D681A1");
const VAULT = getAddress("0x0000000000000000000000000000000000001234");
const FACTORY = getAddress("0x0000000000000000000000000000000000005678");
const OP = () => OPERATOR;

let n = 0;
function setupInput(over: Partial<V2SetupInput> = {}): V2SetupInput {
  n += 1;
  return {
    publicCampaignId: `founding-testers-${n}`,
    title: "Founding testers",
    productUrl: "https://example.com",
    chainId: 59902,
    expectedToken: TOKEN,
    founderAddress: FOUNDER,
    operatorAddress: OPERATOR,
    guardian: "0x0000000000000000000000000000000000000000",
    factoryAddress: FACTORY,
    vaultAddress: VAULT,
    missions: [
      {
        missionKey: "load",
        title: "Break the signup",
        objective: "Bypass email verification",
        instructions: "1. open\n2. try",
        targetSurface: "https://example.com/signup",
        criteria: ["created without verification"],
        evidenceRequirements: ["a recording"],
        rewardBase: BigInt(500_000),
        maxCompletions: BigInt(2),
      },
    ],
    ...over,
  };
}

/** Build a chain snapshot that AGREES with a setup input's computed plan (override to break). */
function snapshotFor(input: V2SetupInput, over: Partial<ChainCampaignSnapshot> = {}): ChainCampaignSnapshot {
  const p = computeV2SetupPreview(input);
  const missions: ChainCampaignSnapshot["missions"] = {};
  p.missions.forEach((m, i) => {
    missions[m.missionIdHash.toLowerCase()] = {
      exists: true,
      rewardBase: input.missions[i].rewardBase,
      maxCompletions: input.missions[i].maxCompletions,
    };
  });
  return {
    factoryRecognizes: true,
    owner: input.founderAddress,
    operator: OPERATOR,
    guardian: "0x0000000000000000000000000000000000000000",
    token: input.expectedToken,
    campaignIdHash: p.campaignIdHash as string,
    missionPlanDigest: p.missionPlanDigest as string,
    budgetCeiling: BigInt(p.totalBudgetBase),
    chainId: input.chainId,
    state: "active",
    replaySupport: "supported",
    missions,
    ...over,
  };
}

function fakeAdapter(snapshot: ChainCampaignSnapshot): CampaignVaultAdapter {
  return {
    readSnapshot: async () => snapshot,
  } as unknown as CampaignVaultAdapter;
}

describe("computeV2SetupPreview — reviewable hashes + budget", () => {
  it("computes campaignIdHash, missionPlanDigest, spec digest, budget", () => {
    const p = computeV2SetupPreview(setupInput());
    expect(p.ok).toBe(true);
    expect(p.campaignIdHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(p.missionPlanDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(p.missions[0].specDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(p.totalBudgetBase).toBe(String(500_000 * 2));
  });
  it("rejects an invalid plan / bad addresses / owner==operator", () => {
    expect(computeV2SetupPreview(setupInput({ missions: [] })).ok).toBe(false);
    expect(computeV2SetupPreview(setupInput({ expectedToken: "0xnope" })).errors).toContain("bad_expectedToken");
    expect(computeV2SetupPreview(setupInput({ operatorAddress: FOUNDER })).errors).toContain("owner_equals_operator");
  });
});

describe("attachV2Campaign — agreement-gated ATOMIC persist", () => {
  it("persists campaign + locked missions ONLY when the vault agrees", async () => {
    const input = setupInput();
    const r = await attachV2Campaign(input, { adapter: fakeAdapter(snapshotFor(input)), operatorAddress: OP });
    expect(r.ok).toBe(true);
    const c = getCampaign(input.publicCampaignId);
    expect(c?.vaultKind).toBe("campaign_v2");
    expect(c?.status).toBe("live");
    const ms = listMissions(input.publicCampaignId);
    expect(ms).toHaveLength(1);
    expect(ms[0].status).toBe("active");
    expect(ms[0].specDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(ms[0].lockedAt).toBeGreaterThan(0);
  });

  it("a mismatched vault (wrong owner) persists NOTHING", async () => {
    const input = setupInput();
    const broken = snapshotFor(input, { owner: `0x${"9".repeat(40)}` });
    const r = await attachV2Campaign(input, { adapter: fakeAdapter(broken), operatorAddress: OP });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("agreement");
      expect(r.errors).toContain("owner_not_founder");
    }
    expect(getCampaign(input.publicCampaignId)).toBeNull(); // NO partial rows
    expect(listMissions(input.publicCampaignId)).toHaveLength(0);
  });

  it("a wrong settlement token fails agreement and persists nothing", async () => {
    const input = setupInput();
    const broken = snapshotFor(input, { token: `0x${"e".repeat(40)}` });
    const r = await attachV2Campaign(input, { adapter: fakeAdapter(broken), operatorAddress: OP });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("token");
    expect(getCampaign(input.publicCampaignId)).toBeNull();
  });

  it("refuses a vault whose on-chain identity does not match the public campaign id (persists nothing)", async () => {
    const input = setupInput();
    // the deployed vault commits a DIFFERENT campaignIdHash than campaignIdHash(publicId).
    const broken = snapshotFor(input, { campaignIdHash: `0x${"a".repeat(64)}` });
    const r = await attachV2Campaign(input, { adapter: fakeAdapter(broken), operatorAddress: OP });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["agreement", "identity"]).toContain(r.stage); // refused before persist
    expect(getCampaign(input.publicCampaignId)).toBeNull(); // NO inconsistent campaign is ever stored
  });

  it("an invalid spec is rejected at validation, before any chain read or write", async () => {
    const input = setupInput();
    input.missions[0].criteria = []; // no criteria
    const r = await attachV2Campaign(input, { adapter: fakeAdapter(snapshotFor(input)), operatorAddress: OP });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe("validation");
    expect(getCampaign(input.publicCampaignId)).toBeNull();
  });
});

describe("setupAllowed — fail closed", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("dev/staging permits the controlled exercise", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(setupAllowed(null, FOUNDER).allowed).toBe(true);
  });
  it("production requires the founder's authenticated session", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(setupAllowed(null, FOUNDER).allowed).toBe(false); // unauthenticated → closed
    expect(setupAllowed("0x9999999999999999999999999999999999999999", FOUNDER).allowed).toBe(false); // wrong wallet
    expect(setupAllowed(FOUNDER, FOUNDER).allowed).toBe(true); // founder authenticated
  });
});
