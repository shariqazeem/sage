import { describe, expect, it } from "vitest";
import { compileDirectCampaign, directCampaignSchema, type DirectCampaignInput } from "./direct-campaign";

/**
 * The evidence line is the ONLY place a worker is told where their deliverable may live. A gig
 * that lets them publish anywhere has no host to name, and joining an empty allow-list blind
 * shipped the live copy "the artifact you created on ." — a sentence that answers nothing.
 */
function gigInput(allowedHosts: string[]): DirectCampaignInput {
  return directCampaignSchema.parse({
    kind: "gig",
    title: "Write and publish a guide",
    productUrl: "https://sagepays.xyz",
    whyItMatters: "A written guide people can follow to collect a payout privately.",
    milestones: [
      {
        title: "Write and publish a guide",
        instructions: "Publish a public page explaining the flow, carrying your wallet address.",
        criteria: ["The page is publicly reachable", "It visibly carries your submitting wallet address"],
        evidence: { kind: "artifact_url", allowedHosts, markerKind: "wallet" },
        rewardUsd: 0.5,
        slots: 1,
      },
    ],
  });
}

const evidenceOf = (hosts: string[]) => {
  const r = compileDirectCampaign(gigInput(hosts), "gig-test");
  if (!("plan" in r)) throw new Error(`compile failed: ${JSON.stringify(r)}`);
  return r.plan.missions[0].evidenceRequirements.join(" ");
};

describe("artifact evidence copy", () => {
  it("never emits the dangling host — the live defect", () => {
    const line = evidenceOf([]);
    expect(line).not.toMatch(/created on \./);
    expect(line).not.toMatch(/ on \s*\./);
  });

  it("tells a publish-anywhere worker they may use any public page", () => {
    expect(evidenceOf([])).toMatch(/any public page/i);
  });

  it("still names the hosts when the mission restricts them", () => {
    const line = evidenceOf(["github.com", "notion.so"]);
    expect(line).toContain("on github.com or notion.so");
    expect(line).not.toMatch(/any public page/i);
  });

  it("always states the marker requirement either way", () => {
    for (const hosts of [[], ["github.com"]])
      expect(evidenceOf(hosts)).toContain("your submitting wallet address");
  });
});
