import { describe, expect, it } from "vitest";
import { restatesMarkerCheck } from "./composer";

/** The card says Sage's own wallet check once, on its own line; a drafted criterion that only restates it is dropped. */
describe("a criterion that only restates Sage's automatic wallet check", () => {
  it.each([
    "The worker's wallet address appears in the PR description",
    "Your wallet address is included at the end of the post",
    "The submitter's own wallet address is visible in the doc",
    "Their USDC wallet address is listed in the video description",
  ])("drops: %s", (c) => {
    expect(restatesMarkerCheck(c)).toBe(true);
  });

  it.each([
    "The PR description lists each broken link found, with the old address and its replacement",
    "The doc names the Safe's wallet address for the treasury it describes",
    "The post links the founder's product page",
    "The guide shows how to connect a wallet to the app, with screenshots of each step and the address format the app expects, so a new user can follow it end to end without help",
  ])("keeps: %s", (c) => {
    expect(restatesMarkerCheck(c)).toBe(false);
  });
});

describe("founder-confirms survives the card, the body and the compiler", () => {
  it("a draft that says the founder confirms compiles into a job that holds for them", async () => {
    const { composerFromDraft, composeDirectBody } = await import("./composer");
    const { directCampaignSchema, compileDirectCampaign } = await import("./direct-campaign");
    const card = composerFromDraft(
      {
        kind: "gig",
        title: "Interview a café owner about ordering",
        who: "anyone",
        slots: 3,
        milestones: [
          {
            title: "Interview a café owner",
            deliverable: "A recap of a real 20-minute interview is shared, and the founder confirms the call happened",
            instructions: "1. Find a café owner who orders supplies weekly.\n2. Talk for 20 minutes.\n3. Share a recap doc with your wallet address.",
            criteria: ["The recap names the café and the owner's role", "It lists three ordering problems in the owner's words"],
            evidence: { kind: "artifact_url", allowedHosts: ["docs.google.com"], founderConfirms: true },
          },
        ],
      },
      "Pay $20 each to three people who interview a café owner",
    );
    expect(card.tranches[0]!.founderConfirms).toBe(true);
    const body = composeDirectBody({ who: card.pay.who, slots: "3", tranches: card.tranches.map((t) => ({ ...t, amount: "20" })), splitTotal: "", currency: "USD", inviteOnly: false, why: "", title: card.title });
    const parsed = directCampaignSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    const compiled = compileDirectCampaign(parsed.success ? parsed.data : (body as never), "gig-test-confirm", null);
    expect(compiled.ok).toBe(true);
    const contract = compiled.ok ? (compiled.plan.missions[0] as { verificationContract?: { founderConfirms?: boolean } }).verificationContract : undefined;
    expect(contract?.founderConfirms).toBe(true);
  });
});
