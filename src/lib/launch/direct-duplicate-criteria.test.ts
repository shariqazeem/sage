import { describe, expect, it } from "vitest";
import { compileDirectCampaign, uniqueCriteria } from "./direct-campaign";

/**
 * A REPEATED CHECK NEVER CRASHES A LAUNCH.
 *
 * Two criteria that read the same made `missionSpecDigest` throw `duplicate_criterion` past every catch,
 * and the founder's create died with a 500 (found 5 Nov 2026 by reading the create path).
 */
describe("duplicate criteria", () => {
  it("keeps each criterion once, compared the way the mission spec compares them", () => {
    expect(uniqueCriteria(["The page is in Spanish", "the page is in  spanish", "Covers every section"])).toEqual([
      "The page is in Spanish",
      "Covers every section",
    ]);
  });

  it("compiles a gig whose drafted checks repeat each other and the automatic one", () => {
    const r = compileDirectCampaign(
      {
        kind: "gig",
        title: "Translate the onboarding guide",
        milestones: [
          {
            title: "Spanish onboarding guide",
            instructions: "1. Translate every section. 2. Publish it and submit the link.",
            criteria: [
              "The page is written in Spanish",
              "The page is written in Spanish",
              "The page carries the submitting wallet address",
              "The page carries the submitting wallet address",
            ],
            evidence: { kind: "artifact_url", allowedHosts: [], markerKind: "wallet" },
            slots: 1,
            rewardUsd: 10,
          },
        ],
      } as never,
      "gig-test000001",
      null,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.missions[0].criteria).toHaveLength(2);
  });
});
