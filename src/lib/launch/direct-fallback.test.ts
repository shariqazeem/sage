import { describe, expect, it } from "vitest";
import { unambiguousGigArgs } from "./direct-fallback";
import type { GigDraft } from "./gig-draft";

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

  it("carries the per-unit price onto the draft's own slot count", () => {
    const a = unambiguousGigArgs("$4 each to the first 5 people who publish a walkthrough", draft({ slots: 5 }));
    expect(a?.milestones[0].rewardUsd).toBe(4);
    expect(a?.milestones[0].slots).toBe(5);
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
  });

  it("carries the draft's own brief through unchanged — it writes no wording of its own", () => {
    const a = unambiguousGigArgs("$20 when they publish it", draft());
    expect(a!.milestones[0].title).toBe("Publish the English menu");
    expect(a!.milestones[0].criteria).toEqual(["Every dish name appears in English", "The page is public"]);
    expect(a!.milestones[0].evidence).toEqual({ kind: "artifact_url", allowedHosts: [] });
  });
});
