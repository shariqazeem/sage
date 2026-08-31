import { describe, expect, it } from "vitest";
import { compileDirectCampaign, directCampaignSchema, effectiveMilestoneUsd, splitTotalBase } from "./direct-campaign";

const base = (usd: number) => BigInt(Math.round(usd * 1_000_000));
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, BigInt(0));

const grant = (over: Record<string, unknown> = {}) => ({
  kind: "grant",
  title: "Grant for a market seller",
  whyItMatters: "Two tranches for a seller getting her catalogue online.",
  milestones: [
    {
      title: "Publish the catalogue",
      instructions: "Publish your public catalogue page carrying your wallet address.",
      criteria: ["The page is publicly reachable", "It carries your submitting wallet address"],
      evidence: { kind: "artifact_url", allowedHosts: [], markerKind: "wallet" },
      slots: 1,
    },
    {
      title: "Post the first customer review",
      instructions: "Publish the page showing your first customer review.",
      criteria: ["The review is visible", "It carries your submitting wallet address"],
      evidence: { kind: "artifact_url", allowedHosts: [], markerKind: "wallet" },
      slots: 1,
    },
  ],
  ...over,
});

describe("splitTotalBase — the arithmetic the model may not do", () => {
  it("sums to the total EXACTLY, including when it does not divide", () => {
    // $40/3 has no exact dollar answer; the invariant still has to hold to the base unit.
    for (const [usd, n] of [[40, 2], [40, 3], [10, 3], [0.99, 7], [100, 6]] as Array<[number, number]>) {
      const shares = splitTotalBase(base(usd), n);
      expect(shares).toHaveLength(n);
      expect(sum(shares)).toBe(base(usd));
    }
  });

  it("spreads the remainder one base unit at a time — never a cent of drift", () => {
    const shares = splitTotalBase(base(10), 3); // 3333333.33…
    expect(shares).toEqual([BigInt(3333334), BigInt(3333333), BigInt(3333333)]);
    expect(Math.max(...shares.map(Number)) - Math.min(...shares.map(Number))).toBe(1);
  });
});

describe("the measured P-DIRECT failure: 'half and half, $40 total'", () => {
  it("compiles now, and each tranche is $20", () => {
    const parsed = directCampaignSchema.safeParse(grant({ splitTotalUsd: 40 }));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(effectiveMilestoneUsd(parsed.data!)).toEqual([20, 20]);
    const r = compileDirectCampaign(parsed.data!, "grant-test");
    expect("plan" in r, "error" in r ? String(r.error) : "").toBe(true);
  });

  it("keeps the exact-sum invariant through the compiler", () => {
    const r = compileDirectCampaign(directCampaignSchema.parse(grant({ splitTotalUsd: 40 })), "g");
    if (!("plan" in r)) throw new Error("compile failed");
    const total = r.plan.missions.reduce(
      (a, m) => a + BigInt(m.rewardBase) * BigInt(m.maxCompletions), BigInt(0),
    );
    expect(total).toBe(base(40));
  });
});

describe("the ambiguous shapes stay REFUSED rather than guessed", () => {
  const bad = (over: Record<string, unknown>) => directCampaignSchema.safeParse(grant(over)).success;

  it("refuses a total ALONGSIDE per-milestone amounts", () => {
    const ms = grant().milestones.map((m) => ({ ...m, rewardUsd: 20 }));
    expect(bad({ splitTotalUsd: 40, milestones: ms })).toBe(false);
  });

  it("refuses MIXED pricing — is the total the whole grant, or only the rest?", () => {
    const ms = grant().milestones.map((m, i) => (i === 0 ? { ...m, rewardUsd: 20 } : m));
    expect(bad({ splitTotalUsd: 40, milestones: ms })).toBe(false);
  });

  it("refuses unpriced milestones with NO total at all", () => {
    expect(bad({})).toBe(false);
  });

  it("refuses a split across multi-slot milestones — a tranche is released once", () => {
    const ms = grant().milestones.map((m) => ({ ...m, slots: 3 }));
    expect(bad({ splitTotalUsd: 40, milestones: ms })).toBe(false);
  });

  it("still accepts the ordinary priced grant, unchanged", () => {
    const ms = grant().milestones.map((m) => ({ ...m, rewardUsd: 20 }));
    expect(bad({ milestones: ms })).toBe(true);
  });
});

describe("the floor still binds", () => {
  it("refuses a split that puts a tranche under the tangible minimum", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...grant().milestones[0], title: `Tranche ${i + 1}` }));
    const r = compileDirectCampaign(
      directCampaignSchema.parse(grant({ splitTotalUsd: 1, milestones: many })), "g",
    );
    expect("plan" in r).toBe(false);
  });
});
