import { describe, expect, it } from "vitest";

import {
  DIRECT_LIMITS,
  compileDirectCampaign,
  createDirectCampaign,
  directCampaignSchema,
  effectiveMilestoneUsd,
  lintDirectCampaign,
  type DirectCampaignInput,
} from "./direct-campaign";
import { loadApprovedPlan } from "./deployment-service";
import { getInspectionJob } from "@/lib/db/inspection";
import { STARKNET_MAINNET_KEY } from "@/lib/deputy/networks";
import { getApprovedRevision } from "@/lib/db/plan-revisions";

/**
 * WORK PROOF — the direct campaign compiler (docs/work-proof-design.md).
 *
 * The operator states milestones + explicit verification contracts + tranche prices; compilation
 * is fully deterministic, the exact-sum budget invariant holds BY CONSTRUCTION, and the persisted
 * result is consumable by the UNCHANGED deploy flow (`loadApprovedPlan`) with the contract, kind,
 * and allowlist surviving the verify-approve-reload round trip.
 */

const GOAT = 2345;

function grantInput(overrides: Partial<DirectCampaignInput> = {}): DirectCampaignInput {
  return {
    kind: "grant",
    title: "Community storefront micro-grant",
    productUrl: "https://example-program.org/grants",
    whyItMatters: "Diaspora-funded milestone capital for a small business, every tranche receipted.",
    milestones: [
      {
        title: "Register the storefront on-chain",
        instructions: "Deploy or register your storefront record from your own wallet, then submit the transaction hash.",
        criteria: ["The registration transaction succeeds on-chain", "It is sent from your own wallet"],
        evidence: {
          kind: "onchain_tx",
          chainId: GOAT,
          to: "0x3022b87ac063DE95b1570F46f5e470F8B53112D8",
          minValueWei: "0",
          methodSelector: "0xa9059cbb",
        },
        rewardUsd: 2,
        slots: 1,
        effortMinutes: 20,
      },
      {
        title: "Publish the storefront page",
        instructions: "Publish your public storefront page carrying your wallet address in the footer, then submit its link.",
        criteria: ["The page is publicly reachable", "It visibly carries your submitting wallet address"],
        evidence: { kind: "artifact_url", allowedHosts: ["storefront.example.org"], markerKind: "wallet" },
        rewardUsd: 1.5,
        slots: 2,
      },
    ],
    allowlist: ["0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    ...overrides,
  };
}

describe("directCampaignSchema — operator input is validated, never trusted", () => {
  it("accepts a well-formed grant", () => {
    expect(directCampaignSchema.safeParse(grantInput()).success).toBe(true);
  });

  it("observation is STRUCTURALLY impossible (no corpus exists to judge against)", () => {
    const input = grantInput();
    (input.milestones[0] as { evidence: unknown }).evidence = { kind: "observation" };
    expect(directCampaignSchema.safeParse(input).success).toBe(false);
  });

  it("an onchain_tx contract with no shape constraint is too weak to gate money", () => {
    const input = grantInput();
    input.milestones[0].evidence = { kind: "onchain_tx", chainId: GOAT };
    expect(directCampaignSchema.safeParse(input).success).toBe(false);
  });

  it("an onchain_state contract needs minUint or expectTesterAddress", () => {
    const input = grantInput();
    input.milestones[0].evidence = {
      kind: "onchain_state",
      chainId: GOAT,
      contract: "0x3022b87ac063DE95b1570F46f5e470F8B53112D8",
      callData: "0x70a08231" + "0".repeat(64),
    };
    expect(directCampaignSchema.safeParse(input).success).toBe(false);
  });

  it("an unknown chain is refused at the schema", () => {
    const input = grantInput();
    input.milestones[0].evidence = { kind: "onchain_tx", chainId: 999999, methodSelector: "0xa9059cbb" };
    expect(directCampaignSchema.safeParse(input).success).toBe(false);
  });

  it(`the tangible floor binds: below $${DIRECT_LIMITS.rewardUsdMin} per completion is refused`, () => {
    const input = grantInput();
    input.milestones[0].rewardUsd = 0.25;
    expect(directCampaignSchema.safeParse(input).success).toBe(false);
  });

  it("sub-cent precision is refused (2 decimals max)", () => {
    const input = grantInput();
    input.milestones[0].rewardUsd = 1.005;
    expect(directCampaignSchema.safeParse(input).success).toBe(false);
  });

  it("an http:// context URL is refused (https only)", () => {
    expect(directCampaignSchema.safeParse(grantInput({ productUrl: "http://example.org" })).success).toBe(false);
  });

  it("a full URL where a bare artifact host belongs is refused", () => {
    const input = grantInput();
    input.milestones[1].evidence = {
      kind: "artifact_url",
      allowedHosts: ["https://storefront.example.org"],
      markerKind: "wallet",
    };
    expect(directCampaignSchema.safeParse(input).success).toBe(false);
  });
});

describe("compileDirectCampaign — deterministic, exact-sum, contract-carrying", () => {
  it("compiles to a canonical plan holding the budget invariant BY CONSTRUCTION", () => {
    const r = compileDirectCampaign(grantInput(), "grant-testplan1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Σ(rewardBase × maxCompletions) === totalBudgetBase === allocatedBase, exactly.
    const sum = r.plan.missions.reduce((s, m) => s + m.rewardBase * m.maxCompletions, BigInt(0));
    expect(sum).toBe(r.plan.totalBudgetBase);
    expect(sum).toBe(r.plan.allocatedBase);
    // $2×1 + $1.50×2 = $5.00
    expect(sum).toBe(BigInt(5_000_000));
    expect(r.plan.status).toBe("deployment_ready");
  });

  it("every mission carries its operator contract; kind + lowercased deduped allowlist ride the plan", () => {
    const r = compileDirectCampaign(grantInput(), "grant-testplan2");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.campaignKind).toBe("grant");
    expect(r.plan.allowlist).toEqual(["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    const kinds = r.plan.missions.map((m) => (m.verificationContract as { kind: string } | undefined)?.kind);
    expect(kinds).toEqual(["onchain_tx", "artifact_url"]);
    expect(r.plan.verifiabilityNote).toMatch(/deterministic check runs first/);
  });

  it("is deterministic: same input + id ⇒ identical digests", () => {
    const a = compileDirectCampaign(grantInput(), "grant-testplan3");
    const b = compileDirectCampaign(grantInput(), "grant-testplan3");
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.plan.missionPlanDigest).toBe(b.plan.missionPlanDigest);
    expect(a.plan.campaignIdHash).toBe(b.plan.campaignIdHash);
    expect(a.plan.missions.map((m) => m.specDigest)).toEqual(b.plan.missions.map((m) => m.specDigest));
  });

  it("duplicate milestone titles get unique mission keys", () => {
    const input = grantInput();
    input.milestones[1].title = input.milestones[0].title;
    const r = compileDirectCampaign(input, "grant-testplan4");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const keys = r.plan.missions.map((m) => m.missionKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it(`refuses a total above $${DIRECT_LIMITS.totalUsdMax}`, () => {
    const input = grantInput();
    input.milestones[0].rewardUsd = 500;
    input.milestones[0].slots = 50; // $25,000
    const r = compileDirectCampaign(input, "grant-testplan5");
    expect(r.ok).toBe(false);
  });
});

describe("createDirectCampaign — persists what the UNCHANGED deploy flow consumes", () => {
  it("job ready + revision approved + loadApprovedPlan round-trips contract/kind/allowlist", () => {
    const founder = "0x1111111111111111111111111111111111111111";
    const r = createDirectCampaign(grantInput(), founder);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const job = getInspectionJob(r.jobId);
    expect(job?.status).toBe("ready");
    expect(job?.founderWallet).toBe(founder);
    expect(job?.totalBudgetBase).toBe(5_000_000);

    const approved = getApprovedRevision(r.jobId);
    expect(approved).not.toBeNull();
    expect(approved?.approverWallet).toBe(founder);

    // The EXACT call the claim route makes — verify-then-reload must reproduce every hash
    // and carry the Work Proof fields through the serde + recompile round trip.
    const loaded = loadApprovedPlan(r.jobId);
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(loaded.plan.publicCampaignId).toBe(r.publicCampaignId);
    expect(loaded.plan.totalBudgetBase).toBe("5000000");
    expect(loaded.plan.campaignKind).toBe("grant");
    expect(loaded.plan.allowlist).toEqual(["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    const kinds = loaded.plan.missions.map((m) => (m.verificationContract as { kind: string } | undefined)?.kind);
    expect(kinds).toEqual(["onchain_tx", "artifact_url"]);
  });
});

describe("lintDirectCampaign — verifiability lint (operator-side, warn-only)", () => {
  it("flags boilerplate-only artifact criteria (the real proof-run gig shape) and stays quiet on substantive ones", () => {
    const thin = grantInput();
    thin.milestones = [
      {
        title: "Publish your deliverable page",
        instructions: "Create a page on paste.rs containing your wallet address and submit the link.",
        criteria: ["Page is published on paste.rs", "Page contains your wallet address"],
        evidence: { kind: "artifact_url", allowedHosts: ["paste.rs"], markerKind: "wallet" },
        rewardUsd: 0.5,
        slots: 1,
      },
    ];
    const notes = lintDirectCampaign(thin);
    expect(notes.some((n) => n.includes("restates the automatic check"))).toBe(true);

    const substantive = grantInput();
    substantive.milestones = [
      {
        title: "Translate the menu",
        instructions: "Publish the full menu translated into English on paste.rs, wallet in the footer.",
        criteria: ["The page contains the menu translated into English — the actual items", "Page contains your wallet address"],
        evidence: { kind: "artifact_url", allowedHosts: ["paste.rs"], markerKind: "wallet" },
        rewardUsd: 5,
        slots: 1,
      },
    ];
    expect(lintDirectCampaign(substantive)).toHaveLength(0);
  });

  it("public_url: short generic text draws the hard warning; long unique text the softer one; big fetched-page rewards draw the size note", () => {
    const weak = grantInput();
    weak.milestones = [
      {
        title: "Announce the launch",
        instructions: "Put the launch note on a public page and submit the link.",
        criteria: ["The page shows the announcement"],
        evidence: { kind: "public_url", expectedText: ["launched"] },
        rewardUsd: 60,
        slots: 1,
      },
    ];
    const notes = lintDirectCampaign(weak);
    expect(notes.some((n) => n.includes("short and generic"))).toBe(true);
    expect(notes.some((n) => n.includes("$60"))).toBe(true);

    const stronger = grantInput();
    stronger.milestones = [
      {
        title: "Announce the launch",
        instructions: "Publish the announcement with the program's full reference line.",
        criteria: ["The page shows the announcement"],
        evidence: { kind: "public_url", expectedText: ["Sunrise Bakery x Sehar Program grant milestone 2 complete"] },
        rewardUsd: 5,
        slots: 1,
      },
    ];
    const notes2 = lintDirectCampaign(stronger);
    expect(notes2.some((n) => n.includes("short and generic"))).toBe(false);
    expect(notes2.some((n) => n.includes("could only exist if the work happened"))).toBe(true);
  });

  it("on-chain contracts draw zero notes, and createDirectCampaign carries the notes to the caller", () => {
    expect(lintDirectCampaign(grantInput()).filter((n) => n.includes("Milestone 1"))).toHaveLength(0);
    const r = createDirectCampaign(grantInput({ title: `lint-carry-${Date.now() % 100000}` }), `0x${"b".repeat(40)}`);
    if (!r.ok) throw new Error(r.error);
    expect(Array.isArray(r.strengthNotes)).toBe(true);
  });
});

describe("productUrl is OPTIONAL — a grant to a person has no product page (P-DIRECT 2026-08-28)", () => {
  it("compiles with no productUrl and uses the campaign's own board as the context surface", () => {
    const input = grantInput();
    delete (input as { productUrl?: string }).productUrl;
    expect(directCampaignSchema.safeParse(input).success).toBe(true);

    const compiled = compileDirectCampaign(input, "grant-noUrl1");
    if (!compiled.ok) throw new Error(compiled.error);
    // every mission points at the campaign board, never an invented URL
    for (const m of compiled.plan.missions) {
      // an absolute URL on THIS deployment's own origin (siteUrl is env-dependent: https on prod)
      expect(m.targetSurface).toContain("/c/grant-noUrl1");
      expect(() => new URL(m.targetSurface)).not.toThrow();
    }
    // the exact-sum invariant is untouched by the change
    const eff = effectiveMilestoneUsd(input);
    const sum = input.milestones.reduce(
      (a, m, i) => a + BigInt(Math.round(eff[i] * 100)) * BigInt(10_000) * BigInt(m.slots),
      BigInt(0),
    );
    expect(compiled.totalBudgetBase).toBe(sum);
  });

  it("still honours a real productUrl when the founder gives one, and still rejects a bad one", () => {
    const withUrl = grantInput();
    const compiled = compileDirectCampaign(withUrl, "grant-withUrl1");
    if (!compiled.ok) throw new Error(compiled.error);
    expect(compiled.plan.missions[0]!.targetSurface).toBe(withUrl.productUrl);

    const bad = grantInput();
    (bad as { productUrl?: string }).productUrl = "http://insecure.example";
    expect(directCampaignSchema.safeParse(bad).success).toBe(false);
  });
});

describe("on-chain milestone chains must be reachable", () => {
  /**
   * The chain registry holds Starknet so that amounts and explorer links are truthful for campaigns
   * settled there. It is NOT somewhere viem can go, and on-chain verification reads EVM logs — so a
   * milestone compiled against it would look valid and then refuse every submission, forever.
   */
  it("refuses a non-EVM chain for an on-chain contract", () => {
    const input = grantInput();
    (input.milestones[0] as { evidence: { chainId: number } }).evidence.chainId =
      STARKNET_MAINNET_KEY;
    expect(directCampaignSchema.safeParse(input).success).toBe(false);
  });

  it("still accepts GOAT, so nothing that worked stopped working", () => {
    expect(directCampaignSchema.safeParse(grantInput()).success).toBe(true);
  });
});
