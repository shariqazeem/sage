import { describe, expect, it } from "vitest";

import { compileDirectCampaign, type DirectCampaignInput } from "@/lib/launch/direct-campaign";
import { planVaultDeployment } from "@/lib/starknet/vault-calls";
import { toFelt } from "@/lib/starknet/felt";

/**
 * THE SEAM BETWEEN THE MONEY LANE AND THE PRIVATE RAIL.
 *
 * Gigs and grants are compiled by the direct lane; testing campaigns are compiled by the mission
 * brain. Both land on the SAME deploy page, which offers the same rail choice — so a founder can
 * take a three-tranche grant to a Cairo vault, and nothing had ever checked what the two produce
 * together.
 *
 * The precondition that could have broken it silently: the Starknet deploy route refuses any
 * mission without a `missionIdHash`, because settlement's fallback keys on a campaign id that does
 * not exist yet, and guessing one there could disagree with the felt looked up later. If the
 * direct lane did not compute those, every grant and gig would be EVM-only — and the failure would
 * appear as a 400 at the last step, after the founder had chosen a rail and was ready to fund.
 *
 * These run the REAL compiler, not a hand-written plan, so they fail if the direct lane ever stops
 * producing what the rail requires.
 */

const OWNER = "0x4f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434";
const OPERATOR = "0x46a1747d854e74e5082c3215841b26dcff182a6a6fd7a1f83c3e1d045996101";
const TOKEN = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
const CLASS = "0x2770f9fde4668abd9bfffbf8aeca2ce5d104ed812054afa22cdc78356500e84";

/** The flagship grant from the money battery: $60, three tranches of $20. */
const grant: DirectCampaignInput = {
  kind: "grant",
  title: "Cousin's shop storefront grant",
  milestones: [
    {
      title: "Publish the shop page",
      instructions: "Publish the catalogue page publicly and submit the link.",
      criteria: ["The page is public and shows the shop's name"],
      evidence: { kind: "public_url", expectedText: ["catalogue"] },
      rewardUsd: 20,
      slots: 1,
    },
    {
      title: "List the first product",
      instructions: "Add the first product with a price and submit the link.",
      criteria: ["A product with a price is listed on the page"],
      evidence: { kind: "public_url", expectedText: ["price"] },
      rewardUsd: 20,
      slots: 1,
    },
    {
      title: "Announce the first sale",
      instructions: "Post the first sale announcement on the page and submit the link.",
      criteria: ["The page announces a completed sale"],
      evidence: { kind: "public_url", expectedText: ["sold"] },
      rewardUsd: 20,
      slots: 1,
    },
  ],
} as DirectCampaignInput;

const compiled = () => {
  const r = compileDirectCampaign(grant, "grant-cousins-shop-a1b2");
  if (!r.ok) throw new Error(`the direct lane refused its own flagship grant: ${r.error}`);
  return r;
};

describe("a grant compiled by the direct lane, deployed to a Cairo vault", () => {
  it("compiles at all — the fixture is the one the money battery uses", () => {
    const r = compiled();
    expect(r.plan.missions).toHaveLength(3);
    expect(r.totalBudgetBase).toBe(BigInt(60_000_000));
  });

  it("gives every mission the id hash the Starknet rail refuses to deploy without", () => {
    // Without this the deploy route answers 400 at the LAST step, after the founder has picked a
    // rail and is ready to fund.
    for (const m of compiled().plan.missions) {
      expect(m.missionIdHash, m.title).toMatch(/^0x[0-9a-f]{64}$/i);
    }
  });

  it("deploys to a vault carrying all three tranches, keyed by the felt settlement looks up", () => {
    const r = compiled();
    const deployment = planVaultDeployment({
      classHash: CLASS,
      owner: OWNER,
      operator: OPERATOR,
      token: TOKEN,
      salt: "0xdeed",
      budgetCeilingBase: r.totalBudgetBase,
      dailyCapBase: r.totalBudgetBase,
      fundingBase: r.totalBudgetBase,
      // EXACTLY what the deploy route does: reduce with toFelt before the calldata is built. A
      // 256-bit mission id hash is not a felt, and the chain would reduce it modulo PRIME — a
      // different number from this mask, keying the vault away from what settlement looks up.
      missions: r.plan.missions.map((m) => ({
        missionId: toFelt(m.missionIdHash),
        rewardBase: BigInt(m.rewardBase),
        maxCompletions: Number(m.maxCompletions),
      })),
      campaignIdHash: r.plan.campaignIdHash,
      missionPlanDigest: r.plan.missionPlanDigest,
    });

    const missions = deployment.calls.filter((c) => c.entrypoint === "add_mission");
    expect(missions).toHaveLength(3);
    for (const m of r.plan.missions) {
      expect(missions.map((c) => BigInt(c.calldata[0]))).toContain(BigInt(toFelt(m.missionIdHash)));
    }
  });

  it("funds exactly what the founder's tranches add up to, in base units", () => {
    const r = compiled();
    const deployment = planVaultDeployment({
      classHash: CLASS, owner: OWNER, operator: OPERATOR, token: TOKEN, salt: "0xdeed",
      budgetCeilingBase: r.totalBudgetBase, dailyCapBase: r.totalBudgetBase, fundingBase: r.totalBudgetBase,
      missions: r.plan.missions.map((m) => ({
        missionId: toFelt(m.missionIdHash), rewardBase: BigInt(m.rewardBase), maxCompletions: Number(m.maxCompletions),
      })),
      campaignIdHash: r.plan.campaignIdHash, missionPlanDigest: r.plan.missionPlanDigest,
    });
    const fund = deployment.calls.find((c) => c.entrypoint === "fund");
    expect(BigInt(fund!.calldata[0])).toBe(BigInt(60_000_000));
    // The frozen budget invariant, restated on this rail: the parts ARE the whole.
    const sum = r.plan.missions.reduce(
      (s, m) => s + BigInt(m.rewardBase) * BigInt(m.maxCompletions), BigInt(0),
    );
    expect(sum).toBe(r.totalBudgetBase);
  });

  it("carries the plan's own identity into the vault, so attach can recognise it later", () => {
    const r = compiled();
    // A vault that does not carry these answers "does not match this plan" at attach — the exact
    // error a founder hit before the digests were written at deploy time.
    expect(r.plan.campaignIdHash).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(r.plan.missionPlanDigest).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it("a gig with many slots survives the same path", () => {
    const gig = compileDirectCampaign(
      {
        kind: "gig",
        title: "Setup guide bounty",
        milestones: [{
          title: "Write a public setup guide",
          instructions: "Publish a setup guide on a public page and submit the link.",
          criteria: ["The guide covers installation end to end"],
          evidence: { kind: "public_url", expectedText: ["install"] },
          rewardUsd: 5,
          slots: 8,
        }],
      } as DirectCampaignInput,
      "gig-setup-guide-c3d4",
    );
    if (!gig.ok) throw new Error(gig.error);
    expect(gig.totalBudgetBase).toBe(BigInt(40_000_000));
    const deployment = planVaultDeployment({
      classHash: CLASS, owner: OWNER, operator: OPERATOR, token: TOKEN, salt: "0xbead",
      budgetCeilingBase: gig.totalBudgetBase, dailyCapBase: gig.totalBudgetBase, fundingBase: gig.totalBudgetBase,
      missions: gig.plan.missions.map((m) => ({
        missionId: toFelt(m.missionIdHash), rewardBase: BigInt(m.rewardBase), maxCompletions: Number(m.maxCompletions),
      })),
      campaignIdHash: gig.plan.campaignIdHash, missionPlanDigest: gig.plan.missionPlanDigest,
    });
    const [, reward, max] = deployment.calls.find((c) => c.entrypoint === "add_mission")!.calldata;
    expect(BigInt(reward)).toBe(BigInt(5_000_000));
    expect(BigInt(max)).toBe(BigInt(8));
  });
});

describe("a mission id that is not a felt is refused, not quietly reduced by the chain", () => {
  it("refuses the RAW 256-bit hash — the value a caller who forgot toFelt would pass", () => {
    /**
     * This is not a live defect: the deploy route reduces at line 81 before it gets here, which is
     * why the live vault is keyed correctly. It is what happens to the NEXT caller.
     *
     * `CallData.compile` passes an oversized value straight through and the chain reduces it
     * MODULO PRIME — a different number from `toFelt`'s mask. The vault would be keyed under one
     * and settlement would ask for the other, so the failure surfaces as NO_SUCH_MISSION to a
     * recipient who has already done the work.
     */
    const r = compiled();
    const raw = r.plan.missions[0].missionIdHash;
    expect(BigInt(raw)).toBeGreaterThan(BigInt(toFelt(raw))); // it genuinely does not fit
    expect(() =>
      planVaultDeployment({
        classHash: CLASS, owner: OWNER, operator: OPERATOR, token: TOKEN, salt: "0xdeed",
        budgetCeilingBase: r.totalBudgetBase, dailyCapBase: r.totalBudgetBase, fundingBase: r.totalBudgetBase,
        missions: r.plan.missions.map((m) => ({
          missionId: m.missionIdHash, rewardBase: BigInt(m.rewardBase), maxCompletions: Number(m.maxCompletions),
        })),
        campaignIdHash: r.plan.campaignIdHash, missionPlanDigest: r.plan.missionPlanDigest,
      }),
    ).toThrow(/not a felt/);
  });
});
