import { describe, expect, it } from "vitest";
import { resolveMilestoneUsd, compileDirectCampaign, type DirectCampaignInput } from "./direct-campaign";
import type { RateQuote } from "@/lib/money/currency";

/**
 * A FOUNDER SAYS "J$5,000", NOT "31.60 USDC".
 *
 * The model passes what it heard — amount plus currency — and never converts, because no model
 * computes a money amount in this product and an exchange rate is exactly the arithmetic that looks
 * harmless while mis-sizing someone's grant. Sage converts once, deterministically, from a stamped
 * rate. Settlement is unchanged: the vault still moves USDC and `allocateBudget` still balances in
 * base units.
 */
const jmd: RateQuote = { base: "USD", currency: "JMD", rate: 158.20882, source: "test", asOf: 1 };

const campaign = (over: Partial<DirectCampaignInput> = {}): DirectCampaignInput =>
  ({
    kind: "grant",
    title: "Shop storefront grant",
    milestones: [
      {
        title: "Publish the shop page",
        instructions: "1. Build the page. 2. Put your wallet address on it. 3. Send the link.",
        criteria: ["The page is public and carries the recipient's wallet address"],
        evidence: { kind: "artifact_url", allowedHosts: [] },
        rewardUsd: 20,
        slots: 1,
      },
    ],
    ...over,
  }) as DirectCampaignInput;

describe("local-currency milestones", () => {
  it("converts the founder's stated local amount deterministically", () => {
    // J$5,000 / 158.20882 = $31.6038 → $31.60 at cent precision
    expect(resolveMilestoneUsd({ rewardLocal: 5000, rewardUsd: 0 }, jmd)).toBeCloseTo(31.6, 2);
  });

  it("leaves a USD campaign completely untouched", () => {
    expect(resolveMilestoneUsd({ rewardUsd: 20 }, null)).toBe(20);
    expect(resolveMilestoneUsd({ rewardLocal: 5000, rewardUsd: 20 }, { ...jmd, currency: "USD", rate: 1 })).toBe(20);
  });

  /** A corridor outage must degrade to the currency that always works, never to a guess. */
  it("falls back to the USD figure when no rate could be stamped", () => {
    expect(resolveMilestoneUsd({ rewardLocal: 5000, rewardUsd: 20 }, null)).toBe(20);
  });

  it("ignores rewardLocal when the model did not send one", () => {
    expect(resolveMilestoneUsd({ rewardUsd: 20 }, jmd)).toBe(20);
  });

  /** THE INVARIANT THAT MUST SURVIVE ALL OF THIS: the vault's allocation still balances exactly. */
  it("keeps Σ(reward × completions) === the funded total, in base units", () => {
    const input = campaign({
      currency: "JMD",
      milestones: [
        { ...campaign().milestones[0]!, rewardLocal: 5000, rewardUsd: 0, slots: 2 },
        { ...campaign().milestones[0]!, title: "List the first product", rewardLocal: 3000, rewardUsd: 0, slots: 1 },
      ],
    });
    const r = compileDirectCampaign(input, "grant-shop-abc123", jmd);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const summed = r.allocation.missions.reduce(
      (acc, m) => acc + m.rewardBase * m.maxCompletions,
      BigInt(0),
    );
    // Assert the field EXISTS before comparing against it — `?? summed` would compare the sum to
    // itself and pass forever if totalBudgetBase ever moved, which is the vacuous-guard trap this
    // codebase keeps rediscovering. Verified: J$5,000 x2 + J$3,000 -> 63_200_000 base units.
    const funded = r.plan.totalBudgetBase;
    expect(typeof funded).toBe("bigint");
    expect(summed).toBe(funded);
    expect(Number(summed) / 1e6).toBeCloseTo(31.6 * 2 + 18.96, 1);
  });

  it("compiles a USD campaign identically with and without a quote argument", () => {
    const a = compileDirectCampaign(campaign(), "gig-x-1");
    const b = compileDirectCampaign(campaign(), "gig-x-1", null);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.allocation.missions[0]!.rewardBase).toBe(b.allocation.missions[0]!.rewardBase);
  });
});
