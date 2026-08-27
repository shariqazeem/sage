import { describe, expect, it } from "vitest";
import { mapDirectCampaignArgs } from "./server";
import { directCampaignSchema } from "@/lib/launch/direct-campaign";

/**
 * THE TRANSPORT MAPPER — forgiving about SHAPE, never about SUBSTANCE. Pinned against the two
 * defects P-DIRECT measured on 2026-08-28: a missing productUrl was coerced to "" (which fails
 * `.url()`, silently neutralising the schema fix that made it optional), and a host written as a
 * full URL — which is how a model naturally writes one — was rejected.
 */
const gig = (over: Record<string, unknown> = {}) => ({
  kind: "gig",
  title: "Menu translation",
  milestones: [
    {
      title: "Translate the menu",
      instructions: "Publish the translated menu on a public page.",
      criteria: ["The page shows the actual translated items"],
      evidence: { kind: "artifact_url", allowedHosts: ["paste.rs"] },
      rewardUsd: 20,
      slots: 1,
    },
  ],
  ...over,
});
const parse = (a: Record<string, unknown>) => directCampaignSchema.safeParse(mapDirectCampaignArgs(a));

describe("mapDirectCampaignArgs", () => {
  it("a grant with NO productUrl parses (a cousin's shop has no web page)", () => {
    const r = parse(gig());
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.productUrl).toBeUndefined();
  });

  it("an empty or whitespace productUrl is treated as absent, never as an invalid URL", () => {
    expect(parse(gig({ productUrl: "" })).success).toBe(true);
    expect(parse(gig({ productUrl: "   " })).success).toBe(true);
  });

  it("a real productUrl still survives, and a non-https one is still refused", () => {
    const ok = parse(gig({ productUrl: "https://shop.example.org" }));
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.productUrl).toBe("https://shop.example.org");
    expect(parse(gig({ productUrl: "http://shop.example.org" })).success).toBe(false);
  });

  it("normalises the host shapes a model actually writes", () => {
    for (const written of ["https://paste.rs", "paste.rs/abc", "www.paste.rs", "PASTE.RS", " https://www.paste.rs/x "]) {
      const r = parse(gig({
        milestones: [{ ...gig().milestones[0], evidence: { kind: "artifact_url", allowedHosts: [written] } }],
      }));
      expect(r.success, `${written} should normalise to a bare host`).toBe(true);
      if (r.success) {
        const ev = r.data.milestones[0]!.evidence as { allowedHosts: string[] };
        expect(ev.allowedHosts[0]).toBe("paste.rs");
      }
    }
  });

  it("derives a campaign title from the first milestone when the model omits it", () => {
    const r = parse(gig({ title: undefined }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.title).toBe("Translate the menu");

    const short = parse(gig({ title: "Hi" }));
    expect(short.success).toBe(true);
    if (short.success) expect(short.data.title).toBe("Translate the menu");

    // a real title always wins
    const kept = parse(gig({ title: "Karachi Grill menu" }));
    if (kept.success) expect(kept.data.title).toBe("Karachi Grill menu");
  });

  it("still refuses substance it cannot rescue: no milestones, junk host", () => {
    expect(parse(gig({ milestones: [] })).success).toBe(false);
    const junk = parse(gig({
      milestones: [{ ...gig().milestones[0], evidence: { kind: "artifact_url", allowedHosts: ["not a host at all"] } }],
    }));
    expect(junk.success).toBe(false);
  });
});

describe("the model's own field names — measured raws (P-DIRECT round 5)", () => {
  it("reads the exact three-tranche grant shape the model produced", () => {
    const r = parse({
      milestones: [
        { title: "Shop page published", instructions: "Publish the shop page", amount: 20, verifyVia: "publicLink" },
        { title: "First product listed", instructions: "List the first product", amount: 20, verifyVia: "publicLink" },
        { title: "First sale announced", instructions: "Announce the first sale", amount: 20, verifyVia: "publicLink" },
      ],
      totalBudgetUsd: 60,
      title: "Cousin's Shop Launch",
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.kind).toBe("grant"); // several tranches inferred as a grant
    expect(r.data.milestones).toHaveLength(3);
    expect(r.data.milestones.every((m) => m.rewardUsd === 20 && m.slots === 1)).toBe(true);
    expect(r.data.milestones.every((m) => m.evidence.kind === "artifact_url")).toBe(true);
  });

  it("reads the Urdu gig shape: amount only at campaign level, one milestone", () => {
    const r = parse({
      milestones: [
        { title: "Bakery menu page published", instructions: "Publish the menu page and share the link", verificationMethod: "public_link" },
      ],
      totalBudgetUsd: 15,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.kind).toBe("gig");
    expect(r.data.milestones[0]!.rewardUsd).toBe(15);
    expect(r.data.milestones[0]!.slots).toBe(1);
  });

  it("NEVER splits a total across several milestones — that would be guessing the founder's intent", () => {
    const r = parse({
      milestones: [
        { title: "First half of the work", instructions: "Do the first half of it", verificationMethod: "publicLink" },
        { title: "Second half of the work", instructions: "Do the second half of it", verificationMethod: "publicLink" },
      ],
      totalBudgetUsd: 40,
    });
    expect(r.success).toBe(false); // fails loudly rather than inventing a 20/20 split
  });

  it("does not rescue a total onto a multi-slot milestone either", () => {
    const r = parse({
      milestones: [{ title: "Write a setup guide", instructions: "Publish a setup guide publicly", verificationMethod: "publicLink", slots: 3 }],
      totalBudgetUsd: 15,
    });
    expect(r.success).toBe(false);
  });

  it("a degenerate single-string arg is refused, not guessed at", () => {
    expect(parse({ _call: "Menu translation gig: $20 when translator publishes the menu" }).success).toBe(false);
  });
});
