import { describe, expect, it } from "vitest";
import { releasesOnThirdPartyDecision, statedCurrency, unambiguousGigArgs } from "./direct-fallback";
import type { GigDraft } from "./gig-draft";
import { compileDirectCampaign, directCampaignSchema } from "./direct-campaign";
import { mapDirectCampaignArgs } from "@/lib/mcp/server";

/**
 * The last resort, and its refusals.
 *
 * P-DIRECT's five remaining failures were one shape: the founder names a job and a price, the model
 * reasons to the right lane, and writes prose. This path compiles the gig without it — but it may
 * author nothing, so what it refuses matters more than what it builds.
 */
const draft = (over: Partial<GigDraft> = {}): GigDraft => ({
  kind: "gig",
  title: "Translate the menu into English",
  who: "a translator",
  slots: 1,
  milestones: [
    {
      title: "Publish the English menu",
      deliverable: "The menu is live in English on a public page.",
      instructions: "1. Translate every item. 2. Publish it publicly. 3. Send the link.",
      criteria: ["Every dish name appears in English", "The page is public"],
      evidence: { kind: "artifact_url", allowedHosts: [] },
      effortMinutes: 40,
    },
  ],
  ...over,
});

describe("unambiguousGigArgs — builds only what the founder's own words settle", () => {
  it("transcribes the one amount they stated onto the one deliverable", () => {
    const a = unambiguousGigArgs(
      "I need someone to translate my restaurant menu into English. $20 when they publish it as a public page. Just one person.",
      draft(),
    );
    expect(a).not.toBeNull();
    expect(a!.kind).toBe("gig");
    expect(a!.milestones).toHaveLength(1);
    expect(a!.milestones[0].rewardUsd).toBe(20);
    expect(a!.milestones[0].slots).toBe(1);
    expect(a!.recipients).toBeUndefined();
  });

  it("reads a price stated in another language, because it is still their number", () => {
    const a = unambiguousGigArgs("quiero pagar 25 dólares a alguien que publique una guía", draft());
    expect(a?.milestones[0].rewardUsd).toBe(25);
  });

  it("carries a per-person price onto the count the founder stated — never the draft's guess", () => {
    const words = "$4 each to the first 5 people who publish a walkthrough";
    const a = unambiguousGigArgs(words, draft({ slots: 5 }));
    expect(a?.milestones[0].rewardUsd).toBe(4);
    expect(a?.milestones[0].slots).toBe(5);
    // the drafter guessed wrong; the founder's words still decide
    expect(unambiguousGigArgs(words, draft({ slots: 3 }))?.milestones[0].slots).toBe(5);
    expect(unambiguousGigArgs("$5 apiece for three testers who record the signup flow", draft({ slots: 3 }))?.milestones[0].slots).toBe(3);
  });

  it("one price with no per-person marker is the whole job — one slot, whatever the draft guessed (P-DIRECT 3)", () => {
    // The row that failed: the drafter is told to guess 3 for "anyone", and reward × slots made $75 of $25.
    const a = unambiguousGigArgs(
      "Pay $25 for this: a public comparison page of our pricing against two named competitors, with a table, at least 400 words, our current prices quoted exactly, and the writer's wallet address in the footer.",
      draft({ slots: 3 }),
    );
    expect(a?.milestones[0].rewardUsd).toBe(25);
    expect(a?.milestones[0].slots).toBe(1);
  });

  it("money that releases on a third party's private decision is refused, as the model is told to (P-DIRECT 5)", () => {
    for (const words of [
      "Send my cousin $200 when the bank finally approves her loan application.",
      "pay my nephew $50 when he gets the job at the port",
      "give her $100 once her visa is approved",
      "$30 when the client accepts the design",
      "Dale $200 a mi prima cuando el banco apruebe el préstamo",
    ]) {
      expect(releasesOnThirdPartyDecision(words), words).toBe(true);
      expect(unambiguousGigArgs(words, draft({ slots: 1 })), words).toBeNull();
    }
  });

  it("a deliverable Sage can check itself is not a third party's decision", () => {
    for (const words of [
      "pay my designer $50 when the new logo page is live on my site",
      "release $60 when the delivery confirmation for invoice INV-1042 is public",
      "half when she publishes her catalogue online and half when she posts her first customer review. $40 total",
      "$25 when she posts her numbers publicly",
    ]) {
      expect(releasesOnThirdPartyDecision(words), words).toBe(false);
    }
  });

  it("a per-person price with no stated count is refused — how many people is a money decision", () => {
    expect(unambiguousGigArgs("$4 each to anyone who publishes a walkthrough of my onboarding", draft({ slots: 3 }))).toBeNull();
  });

  it("keeps a named person a named person, never an open bounty", () => {
    const wallet = "0x04f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434";
    const a = unambiguousGigArgs(`Pay my designer $50 when the logo page is live. Her wallet is ${wallet}.`, draft());
    expect(a?.recipients).toEqual([wallet.toLowerCase()]);
  });

  it("refuses when the founder stated more than one amount — splitting is a decision", () => {
    expect(unambiguousGigArgs("$60 in three parts: $20, $20 and $20", draft())).toBeNull();
  });

  it("refuses when they stated no amount at all", () => {
    expect(unambiguousGigArgs("I want to pay someone to design a logo for me", draft())).toBeNull();
  });

  it("refuses a multi-milestone draft — one amount cannot be mapped onto tranches", () => {
    const d = draft();
    const multi = draft({ milestones: [d.milestones[0], { ...d.milestones[0], title: "Second step" }] });
    expect(unambiguousGigArgs("$50 for the work", multi)).toBeNull();
    // "in two parts" without "equal" is still a split someone would have to decide
    expect(unambiguousGigArgs("$50 for the work, in two parts", multi)).toBeNull();
    // the founder's count must be the draft's count
    expect(unambiguousGigArgs("$50 in three equal parts", multi)).toBeNull();
  });

  it("an EQUAL split the founder stated is transcribed as the total, never divided here (P-DIRECT 5)", () => {
    const d = draft();
    const two = draft({
      kind: "grant",
      milestones: [
        { ...d.milestones[0], title: "Catalogue page online" },
        { ...d.milestones[0], title: "First customer review posted" },
      ],
    });
    const j = unambiguousGigArgs(
      "Give a market seller J$10,000 in two equal parts — half when her catalogue page is online with her wallet address on it, half when she posts her first customer review.",
      two,
    );
    expect(j).not.toBeNull();
    expect(j!.kind).toBe("grant");
    expect(j!.currency).toBe("JMD");
    expect(j!.splitTotalLocal).toBe(10000);
    expect(j!.splitTotalUsd).toBeUndefined();
    expect(j!.milestones).toHaveLength(2);
    expect(j!.milestones.every((m) => m.rewardUsd === undefined && m.slots === 1)).toBe(true);

    const es = unambiguousGigArgs(
      "Quiero dar $50 a una vendedora en dos partes iguales: la mitad cuando publique su catálogo y la mitad cuando muestre su primera venta.",
      two,
    );
    expect(es?.splitTotalUsd).toBe(50);
    expect(es?.currency).toBeUndefined();
    expect(es?.milestones).toHaveLength(2);
  });

  it("the rung's equal-split args are what the REAL compiler accepts and divides — two lists that must not drift", () => {
    const d = draft();
    const two = draft({
      kind: "grant",
      milestones: [
        { ...d.milestones[0], title: "Catalogue page online" },
        { ...d.milestones[0], title: "First customer review posted" },
      ],
    });
    const args = unambiguousGigArgs("Give a market seller J$10,000 in two equal parts — half when her catalogue page is online, half when she posts her first customer review.", two);
    // Production's exact path: the rung's args cross the tool boundary (mapDirectCampaignArgs
    // normalises transport shapes and stamps the wallet marker) before the compiler's schema.
    const parsed = directCampaignSchema.safeParse(mapDirectCampaignArgs(args as unknown as Record<string, unknown>));
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    if (!parsed.success) return;
    const quote = { base: "USD" as const, currency: "JMD", rate: 158.37, source: "test-rates", asOf: 1_800_000_000 };
    const r = compileDirectCampaign(parsed.data, "pub-rung-jmd", quote);
    expect(r.ok, r.ok ? "" : JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(true);
    if (!r.ok) return;
    expect(r.plan.missions).toHaveLength(2);
    expect(r.plan.missions.map((m) => m.rewardLocal)).toEqual([5000, 5000]);
    expect(r.plan.denomination?.currency).toBe("JMD");
    expect(r.plan.denomination?.localTotal).toBe(10_000);
    // the exact-sum invariant, in base units, over what the compiler divided
    const total = r.plan.missions.reduce((acc, m) => acc + BigInt(m.rewardBase) * BigInt(m.maxCompletions), BigInt(0));
    expect(total).toBe(BigInt(r.plan.totalBudgetBase));
  });

  it("reads the currency the founder wrote, and a bare $ as USD", () => {
    expect(statedCurrency("J$10,000 in two equal parts")).toBe("JMD");
    expect(statedCurrency("TT$500 when the page is live")).toBe("TTD");
    expect(statedCurrency("10,000 JMD across two milestones")).toBe("JMD");
    expect(statedCurrency("$50 when the page is live")).toBeNull();
  });

  it("carries the draft's own brief through unchanged — it writes no wording of its own", () => {
    const a = unambiguousGigArgs("$20 when they publish it", draft());
    expect(a!.milestones[0].title).toBe("Publish the English menu");
    expect(a!.milestones[0].criteria).toEqual(["Every dish name appears in English", "The page is public"]);
    expect(a!.milestones[0].evidence).toEqual({ kind: "artifact_url", allowedHosts: [] });
  });
});
