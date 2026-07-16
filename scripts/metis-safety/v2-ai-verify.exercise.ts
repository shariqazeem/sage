import { describe, it, expect } from "vitest";
import { composeProof, isFoundProof } from "@/lib/deputy/proof";

/**
 * Verify the canonical, TRUSTLESS V2 proof for the real AI-bound payout. The
 * composer recomputes campaignIdHash + missionIdHash + MissionSpecV1 digest + the
 * DecisionCommitmentV2 from the stored record and cross-checks them against the
 * on-chain event — it trusts nothing stored. A `settled` state with a verified
 * commitment is the whole point: the payout is provably bound to the AI decision.
 */
const TX = "0x912b48cefdddad6c4c25701482ea0f1210051df271d9e349c379f0d0981e4024";

describe("V2 AI-proof — canonical proof verifies (AI-bound)", () => {
  it("composeProof returns a settled, verified V2 proof", async () => {
    const proof = await composeProof(TX, 59902);
    console.log("PROOF_FULL", JSON.stringify(proof, null, 2));
    expect(isFoundProof(proof)).toBe(true);
    if (isFoundProof(proof)) {
      // committed_settlement = on-chain settlement WITH a verified DecisionCommitmentV2.
      expect(proof.state).toBe("committed_settlement");
      expect(proof.commitmentVersion).toBe(2);
      expect(proof.vaultKind).toBe("campaign_v2");
      expect(proof.commitment?.matches).toBe(true); // AI-bound: recomputed == stored == on-chain
      expect(proof.v2?.integrity?.verified).toBe(true); // every recomputed V2 field agrees
      // the MissionSpecV1 digest recomputes to the stored/frozen 0x20cc2062…
      expect(proof.v2?.missionSpecDigest?.recomputed).toBe(proof.v2?.missionSpecDigest?.stored);
      expect(proof.v2?.missionSpecDigest?.stored).toBe(
        "0x20cc206239baf11097d21683a2602d1ba56e4dc9ca36356e05f32d0cbf20e8ad",
      );
    }
  });
});
