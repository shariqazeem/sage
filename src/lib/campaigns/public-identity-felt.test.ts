import { describe, expect, it } from "vitest";

import { verifyPublicIdentity } from "./public-identity";
import { toFieldHash } from "./field-hash";
import { campaignIdHash, missionIdHash } from "./mission-plan";

/**
 * THE SAME BUG, ONE STAGE LATER.
 *
 * After the agreement check was taught that a felt is 251 bits, the founder hit an identical wall
 * in `verifyPublicIdentity` — a second hand-written `eqHex` that knew nothing about the first.
 * "This plan's identity does not match the vault it was funded into", about a vault bound to it
 * correctly. Both now share one implementation.
 */

const PUBLIC_ID = "launch-starkscan-co-s2k7yd";
const MISSION_KEY = "verify-transfers";

const mission = {
  missionKey: MISSION_KEY,
  missionIdHash: missionIdHash(PUBLIC_ID, MISSION_KEY),
  specDigest: "0x0",
  title: "t",
  objective: "o",
  instructions: "i",
  targetSurface: "https://x",
  criteria: ["c"],
  evidenceList: ["e"],
  rewardBase: BigInt(500_000),
  maxCompletions: BigInt(2),
};

describe("identity against a vault that stored the reduced form", () => {
  it("accepts the on-chain campaign id once it has passed through a felt", () => {
    const cid = campaignIdHash(PUBLIC_ID);
    const r = verifyPublicIdentity({
      publicCampaignId: PUBLIC_ID,
      storedCampaignIdHash: cid,
      storedMissionPlanDigest: null,
      missions: [mission],
      onchain: { campaignIdHash: toFieldHash(cid), missionPlanDigest: toFieldHash(cid) },
    });
    expect(r.mismatches.map((m) => m.reason)).not.toContain("public_campaign_id_hash_mismatch");
  });

  it("still refuses a genuinely different campaign id", () => {
    // The fix must not be "compare nothing".
    const r = verifyPublicIdentity({
      publicCampaignId: PUBLIC_ID,
      storedCampaignIdHash: campaignIdHash(PUBLIC_ID),
      storedMissionPlanDigest: null,
      missions: [mission],
      onchain: {
        campaignIdHash: toFieldHash(campaignIdHash("some-other-campaign")),
        missionPlanDigest: "0x1",
      },
    });
    expect(r.mismatches.map((m) => m.reason)).toContain("public_campaign_id_hash_mismatch");
  });

  it("leaves an unreduced (EVM) on-chain value matching exactly as before", () => {
    const cid = campaignIdHash(PUBLIC_ID);
    const r = verifyPublicIdentity({
      publicCampaignId: PUBLIC_ID,
      storedCampaignIdHash: cid,
      storedMissionPlanDigest: null,
      missions: [mission],
      onchain: { campaignIdHash: cid, missionPlanDigest: cid },
    });
    expect(r.mismatches.map((m) => m.reason)).not.toContain("public_campaign_id_hash_mismatch");
  });
});
