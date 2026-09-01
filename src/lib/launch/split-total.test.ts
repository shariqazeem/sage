import { describe, expect, it } from "vitest";
import { compileDirectCampaign, directCampaignSchema, effectiveMilestoneBase, effectiveMilestoneUsd, lintDirectCampaign, splitTotalBase } from "./direct-campaign";
import { toUsdBase } from "@/lib/money/currency";

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

describe("the invariant CHECK must be exact, not just the split (P-DIRECT, 2026-08-31)", () => {
  const grantN = (n: number, totalUsd: number) =>
    directCampaignSchema.parse({
      kind: "grant",
      title: "Tranches",
      whyItMatters: "A grant released in equal parts as the work lands.",
      splitTotalUsd: totalUsd,
      milestones: Array.from({ length: n }, (_, i) => ({
        title: `Tranche ${i + 1}`,
        instructions: "Publish the agreed deliverable for this tranche.",
        criteria: ["The deliverable is public", "It carries your submitting wallet address"],
        evidence: { kind: "artifact_url", allowedHosts: [], markerKind: "wallet" },
        slots: 1,
      })),
    });

  it("base-unit shares sum to the compiled budget for totals that do NOT divide into cents", () => {
    // $100/3 is 33.333333… — the case that reported BUDGET INVARIANT BROKEN on a correct plan.
    for (const [n, total] of [[3, 100], [3, 40], [7, 10], [6, 0.99], [9, 100]] as Array<[number, number]>) {
      const input = grantN(n, total);
      const r = compileDirectCampaign(input, "g");
      if (!("plan" in r)) continue; // below the tangible floor — a different, tested refusal
      const sum = effectiveMilestoneBase(input).reduce(
        (a, b, i) => a + b * BigInt(input.milestones[i].slots), BigInt(0),
      );
      const compiled = r.plan.missions.reduce(
        (a, m) => a + BigInt(m.rewardBase) * BigInt(m.maxCompletions), BigInt(0),
      );
      expect(sum, `${n} tranches of $${total}`).toBe(compiled);
    }
  });

  it("the DOLLAR view is lossy for such a split — which is why the check may not use it", () => {
    const input = grantN(3, 100);
    const viaCents = effectiveMilestoneUsd(input).reduce(
      (a, d) => a + BigInt(Math.round(d * 100)) * BigInt(10_000), BigInt(0),
    );
    const viaBase = effectiveMilestoneBase(input).reduce((a, b) => a + b, BigInt(0));
    expect(viaBase).toBe(BigInt(100_000_000));
    expect(viaCents).not.toBe(viaBase); // the exact defect, pinned so nobody "simplifies" it back
  });
});

describe("a founder who prices the whole grant in THEIR currency (pd-grant-currency-tranches)", () => {
  const JMD: import("@/lib/money/currency").RateQuote = {
    base: "USD", currency: "JMD", rate: 155, source: "test", asOf: 1_900_000_000,
  };
  const localGrant = (over: Record<string, unknown> = {}) =>
    directCampaignSchema.safeParse({ ...grant({ currency: "JMD", splitTotalLocal: 10_000 }), ...over });

  it("J$10,000 in two equal parts now COMPILES — and the halves sum to the converted total exactly", () => {
    const parsed = localGrant();
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const r = compileDirectCampaign(parsed.data!, "g", JMD);
    expect("plan" in r, "error" in r ? String((r as { error: string }).error) : "").toBe(true);
    if (!("plan" in r)) return;
    const total = r.plan.missions.reduce((a, m) => a + BigInt(m.rewardBase) * BigInt(m.maxCompletions), BigInt(0));
    // toUsdBase floors: 10000/155 = $64.516129... → 64516129 base units, split 64516065+64516064... no —
    // the identity under test is the INVARIANT, not the constant: parts === converted whole.
    expect(total).toBe(toUsdBase(10_000, JMD));
  });

  it("refuses to price a local total with NO rate — a guessed exchange rate is model math by proxy", () => {
    const parsed = localGrant();
    const r = compileDirectCampaign(parsed.data!, "g", null);
    expect("plan" in r).toBe(false);
    if (!("error" in r)) return;
    expect(r.error).toMatch(/no rate for JMD/i);
  });

  it("refuses one total in two currencies", () => {
    expect(localGrant({ splitTotalUsd: 64 }).success).toBe(false);
  });

  it("refuses a local total with no currency named", () => {
    const p = directCampaignSchema.safeParse(grant({ splitTotalLocal: 10_000 }));
    expect(p.success).toBe(false);
  });

  it("the floor speaks the founder's units", () => {
    // J$100 across 2 tranches ≈ $0.32 each — under the $0.50 floor; the refusal must say J$.
    const parsed = localGrant({ splitTotalLocal: 100 });
    expect(parsed.success).toBe(true);
    const r = compileDirectCampaign(parsed.data!, "g", JMD);
    expect("plan" in r).toBe(false);
    if (!("error" in r)) return;
    expect(r.error).toContain("J$");
  });
});

describe("the mapper reads a currency campaign's total as LOCAL (the model's verbatim number)", () => {
  it("moves splitTotalUsd onto splitTotalLocal when a non-USD currency rides the call", async () => {
    const { mapDirectCampaignArgs } = await import("@/lib/mcp/server");
    const mapped = mapDirectCampaignArgs({
      kind: "grant", title: "Two tranches", currency: "JMD", splitTotalUsd: 10_000,
      milestones: [
        { title: "Catalogue", instructions: "publish the catalogue page", criteria: ["live"], evidence: { kind: "artifact_url", allowedHosts: [] }, slots: 1 },
        { title: "Review", instructions: "post the first review", criteria: ["live"], evidence: { kind: "artifact_url", allowedHosts: [] }, slots: 1 },
      ],
    }) as { splitTotalUsd?: number; splitTotalLocal?: number; currency?: string };
    expect(mapped.splitTotalLocal).toBe(10_000);
    expect(mapped.splitTotalUsd).toBeUndefined();
    // …and the currency SURVIVES — round 5 measured the rescue building a local total the schema
    // then refused, because the mapper read the currency and discarded it. A field the rescue
    // depends on must ride the same output.
    expect(mapped.currency).toBe("JMD");
  });

  it("an INVENTED chain id defaults to the settlement chain; a KNOWN one passes untouched", async () => {
    const { mapDirectCampaignArgs } = await import("@/lib/mcp/server");
    const m = (chainId: unknown) =>
      (mapDirectCampaignArgs({
        kind: "gig", title: "Deploy check",
        milestones: [
          { title: "Deploy the contract", instructions: "deploy it and send the tx", criteria: ["deployed"], evidence: { kind: "onchain_tx", chainId, to: "0x" + "a".repeat(40) }, slots: 1, rewardUsd: 10 },
        ],
      }) as { milestones: Array<{ evidence: { chainId: number } }> }).milestones[0].evidence.chainId;
    expect(m(1)).toBe(2345);        // famous-chain invention → where Sage settles
    expect(m(undefined)).toBe(2345); // absence → the default
    expect(m(59902)).toBe(59902);    // a chain Sage KNOWS passes through untouched
  });

  it("a per-milestone LOCAL amount survives the mapper alongside its currency", async () => {
    const { mapDirectCampaignArgs } = await import("@/lib/mcp/server");
    const mapped = mapDirectCampaignArgs({
      kind: "gig", title: "Menu translation", currency: "JMD",
      milestones: [
        { title: "Translate the menu", instructions: "publish the translated menu page", criteria: ["live"], evidence: { kind: "artifact_url", allowedHosts: [] }, slots: 1, rewardUsd: 15, rewardLocal: 2000 },
      ],
    }) as { currency?: string; milestones: Array<{ rewardLocal?: number }> };
    expect(mapped.currency).toBe("JMD");
    expect(mapped.milestones[0].rewardLocal).toBe(2000);
  });

  it("leaves a genuine USD total alone", async () => {
    const { mapDirectCampaignArgs } = await import("@/lib/mcp/server");
    const mapped = mapDirectCampaignArgs({
      kind: "grant", title: "Two tranches", splitTotalUsd: 40,
      milestones: [
        { title: "Catalogue", instructions: "publish the catalogue page", criteria: ["live"], evidence: { kind: "artifact_url", allowedHosts: [] }, slots: 1 },
        { title: "Review", instructions: "post the first review", criteria: ["live"], evidence: { kind: "artifact_url", allowedHosts: [] }, slots: 1 },
      ],
    }) as { splitTotalUsd?: number; splitTotalLocal?: number };
    expect(mapped.splitTotalUsd).toBe(40);
    expect(mapped.splitTotalLocal).toBeUndefined();
  });
});

describe("createDirectCampaign threads the quote everywhere — the lint included", () => {
  it("a local split survives create end to end (measured: the lint threw quote-less)", async () => {
    const { createDirectCampaign } = await import("./direct-campaign");
    const JMDq: import("@/lib/money/currency").RateQuote = { base: "USD", currency: "JMD", rate: 155, source: "test", asOf: 1_900_000_000 };
    const input = directCampaignSchema.parse({ ...grant({ currency: "JMD", splitTotalLocal: 10_000 }) });
    const r = createDirectCampaign(input, "0x" + "f1".repeat(20), JMDq);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });
});

describe("host words that mean ANYWHERE drop to the empty allow-list (round 8)", () => {
  it("junk hosts drop; real hosts survive; full URLs normalize", async () => {
    const { mapDirectCampaignArgs } = await import("@/lib/mcp/server");
    const hosts = (allowedHosts: unknown[]) =>
      (mapDirectCampaignArgs({
        kind: "gig", title: "Open bounty",
        milestones: [{ title: "Write a setup guide", instructions: "publish a public setup guide", criteria: ["live"], evidence: { kind: "artifact_url", allowedHosts }, slots: 1, rewardUsd: 5 }],
      }) as { milestones: Array<{ evidence: { allowedHosts: string[] } }> }).milestones[0].evidence.allowedHosts;
    expect(hosts(["any public host"])).toEqual([]); // the words MEAN anywhere
    expect(hosts(["https://app.example.com/path"])).toEqual(["app.example.com"]);
    expect(hosts(["Example.com", "anywhere"])).toEqual(["example.com"]);
  });
});

describe("a gig priced per-tranche in the FOUNDER'S currency (visible currencies, 1 Sep)", () => {
  const JMD2: import("@/lib/money/currency").RateQuote = {
    base: "USD", currency: "JMD", rate: 155, source: "test", asOf: 1_900_000_000,
  };
  const localGig = (over: Record<string, unknown> = {}) =>
    directCampaignSchema.safeParse({
      kind: "gig",
      title: "Menu translation",
      currency: "JMD",
      milestones: [
        { title: "Translate the menu", instructions: "publish the translated menu as a public page", criteria: ["The page is live"], evidence: { kind: "artifact_url", allowedHosts: [], markerKind: "wallet" }, slots: 1, rewardLocal: 2000 },
      ],
      ...over,
    });

  it("J$2,000 for one deliverable is a PRICED milestone — schema, resolver, compiler", () => {
    const p = localGig();
    expect(p.success, JSON.stringify(p.error?.issues)).toBe(true);
    const r = compileDirectCampaign(p.data!, "g", JMD2);
    expect("plan" in r, "error" in r ? String((r as { error: string }).error) : "").toBe(true);
    if (!("plan" in r)) return;
    // exact conversion at cent precision through the resolver: 2000/155 = $12.90
    expect(r.plan.missions[0].rewardBase).toBe(BigInt(12_900_000));
  });

  it("with NO rate it refuses in words — never a $0 mission", () => {
    const r = compileDirectCampaign(localGig().data!, "g", null);
    expect("plan" in r).toBe(false);
    if (!("error" in r)) return;
    expect(r.error).toMatch(/no rate for JMD/i);
  });

  it("a local amount with no currency named is not a price", () => {
    expect(localGig({ currency: undefined }).success).toBe(false);
  });

  it("the local figure OUTRANKS a stray USD figure when a rate exists — the founder's words win", () => {
    const p = localGig({
      milestones: [{ title: "Translate the menu", instructions: "publish the translated menu as a public page", criteria: ["The page is live"], evidence: { kind: "artifact_url", allowedHosts: [], markerKind: "wallet" }, slots: 1, rewardLocal: 2000, rewardUsd: 99 }],
    });
    expect(p.success).toBe(true);
    const r = compileDirectCampaign(p.data!, "g", JMD2);
    if (!("plan" in r)) throw new Error("compile failed");
    expect(r.plan.missions[0].rewardBase).toBe(BigInt(12_900_000));
  });
});

describe("lint is total — advice never crashes the caller (round 9)", () => {
  it("quote-less lint on a locally-priced plan returns the no-rate message as its one note", () => {
    const input = directCampaignSchema.parse(grant({ currency: "JMD", splitTotalLocal: 10_000 }));
    const notes = lintDirectCampaign(input);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("no rate for JMD");
  });
});
