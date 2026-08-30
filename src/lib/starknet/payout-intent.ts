import { keccak256, toBytes } from "viem";

import type { Campaign, Submission } from "@/lib/db/schema";

/**
 * THE COMMITMENTS A CAIRO VAULT IS ASKED TO STORE.
 *
 * The EVM commitment (`computeDecisionCommitmentV2`) encodes the vault and the recipient as ABI
 * `address` — twenty bytes. A Starknet address is a felt, thirty-two, so it does not merely fail a
 * checksum there: it cannot be encoded as that type at all. `getAddress` threw on the felt long
 * before the encoder got a chance to, and because `derivePayoutIntent` only reaches the commitment
 * when a DECISION EXISTS, this never fired in any dry run or test — every one of those had no
 * judged decision row. It fired the first time a founder released judged work.
 *
 * REPORTED live: "On-chain settlement failed. The submission is approved; retry to settle."
 *
 * So this rail derives its own. What the vault actually requires of these two values is narrow:
 * both non-zero, and the intent STABLE for a given submission so a retry or a sweep re-fire is
 * recognised as the same authorisation rather than a second one. Neither is verified on chain
 * against an EVM ABI, because there is no EVM verifier on this rail — the Cairo vault stores them
 * as opaque felts and compares them for replay.
 *
 * DELIBERATELY NOT the EVM digest with the addresses swapped out. Producing a value that LOOKS
 * like a v2 commitment but was built from different bytes would be worse than an honestly separate
 * derivation: anything comparing the two would silently disagree.
 */

export interface StarknetPayoutIntent {
  /** Replay key. Stable per submission, so a retry is the same authorisation, not a new one. */
  payoutIntentHash: string;
  /** Binds the payout to the judged decision. Null only when nothing judged it. */
  decisionDigest: string | null;
}

/** The fields of a decision this commitment covers. Kept narrow and stable on purpose. */
export interface StarknetDecisionFacts {
  id: string;
  contentSha256: string | null;
  recommendation: string;
  reasonCode: string;
  confidence: number;
  model: string | null;
}

export function starknetPayoutIntent(
  campaign: Campaign,
  submission: Submission,
  decision: StarknetDecisionFacts | null,
): StarknetPayoutIntent {
  /**
   * The intent covers the SUBMISSION, not the decision. A held submission that is re-judged before
   * being released must present the same authorisation, or the vault would treat the second
   * attempt as a fresh one and its replay protection would stop protecting anything.
   */
  const payoutIntentHash = keccak256(
    toBytes(`starknet:intent:v1:${campaign.id}:${submission.id}`),
  );

  if (!decision) return { payoutIntentHash, decisionDigest: null };

  // Confidence is rounded to basis points before hashing: it arrives as a float, and a digest that
  // moves with floating-point noise is not a commitment to anything.
  const decisionDigest = keccak256(
    toBytes(
      [
        "starknet:decision:v1",
        campaign.id,
        submission.id,
        decision.id,
        decision.contentSha256 ?? "",
        decision.recommendation,
        decision.reasonCode,
        String(Math.round(decision.confidence * 10_000)),
        decision.model ?? "",
      ].join("|"),
    ),
  );

  return { payoutIntentHash, decisionDigest };
}
