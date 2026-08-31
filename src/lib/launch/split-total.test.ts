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

describe("the mapper does not manufacture NaN (P-DIRECT, 2026-08-31)", () => {
  it("omits rewardUsd entirely when the model left it out", async () => {
    const { mapDirectCampaignArgs } = await import("@/lib/mcp/server");
    const mapped = mapDirectCampaignArgs({
      kind: "grant",
      title: "Two tranches",
      splitTotalUsd: 40,
      milestones: [
        { title: "Catalogue", instructions: "publish the catalogue page", criteria: ["live"], evidence: { kind: "artifact_url", allowedHosts: [] }, slots: 1 },
        { title: "Review", instructions: "post the first review", criteria: ["live"], evidence: { kind: "artifact_url", allowedHosts: [] }, slots: 1 },
      ],
    }) as { milestones: Array<Record<string, unknown>>; splitTotalUsd?: number };
    // Number(undefined) is NaN, and the schema then complains about a field the founder priced
    // at the campaign level and the model was RIGHT to leave out.
    for (const m of mapped.milestones) expect("rewardUsd" in m).toBe(false);
    expect(mapped.splitTotalUsd).toBe(40);
    expect(directCampaignSchema.safeParse(mapped).success).toBe(true);
  });

  it("reads the model's own campaign-level total across several tranches", async () => {
    const { mapDirectCampaignArgs } = await import("@/lib/mcp/server");
    const mapped = mapDirectCampaignArgs({
      kind: "grant",
      title: "Two tranches",
      totalBudgetUsd: 40, // where the model actually puts it, measured
      milestones: [
        { title: "Catalogue", instructions: "publish the catalogue page", criteria: ["live"], evidence: { kind: "artifact_url", allowedHosts: [] }, slots: 1 },
        { title: "Review", instructions: "post the first review", criteria: ["live"], evidence: { kind: "artifact_url", allowedHosts: [] }, slots: 1 },
      ],
    }) as { splitTotalUsd?: number };
    expect(mapped.splitTotalUsd).toBe(40);
  });

  it("does NOT split when the founder priced the tranches themselves", async () => {
    const { mapDirectCampaignArgs } = await import("@/lib/mcp/server");
    const mapped = mapDirectCampaignArgs({
      kind: "grant",
      title: "Two tranches",
      totalBudgetUsd: 40,
      milestones: [
        { title: "Catalogue", instructions: "publish the catalogue page", criteria: ["live"], evidence: { kind: "artifact_url", allowedHosts: [] }, slots: 1, rewardUsd: 30 },
        { title: "Review", instructions: "post the first review", criteria: ["live"], evidence: { kind: "artifact_url", allowedHosts: [] }, slots: 1, rewardUsd: 10 },
      ],
    }) as { splitTotalUsd?: number };
    expect(mapped.splitTotalUsd).toBeUndefined();
  });
});

describe("a named recipient may be on either rail", () => {
  const withAllowlist = (w: string) =>
    directCampaignSchema.safeParse({
      kind: "gig",
      title: "Logo page",
      whyItMatters: "Paying a designer for the new logo page.",
      allowlist: [w],
      milestones: [
        { title: "Publish the logo page", instructions: "Publish it live on the site.", criteria: ["The page is live"], evidence: { kind: "artifact_url", allowedHosts: [], markerKind: "wallet" }, slots: 1, rewardUsd: 50 },
      ],
    }).success;

  it("accepts a Starknet felt — the rail Sage just launched", () => {
    expect(withAllowlist("0x04f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434")).toBe(true);
    expect(withAllowlist("0x5db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048")).toBe(true);
  });

  it("still accepts an EVM address", () => {
    expect(withAllowlist("0x" + "a".repeat(40))).toBe(true);
  });

  it("still refuses something that is not an address at all", () => {
    for (const bad of ["not-a-wallet", "0x", "0xZZZZ", "0x" + "a".repeat(65)]) expect(withAllowlist(bad)).toBe(false);
  });
});
