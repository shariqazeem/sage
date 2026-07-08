import { keccak256, toBytes, type Hash } from "viem";

/**
 * One submission per (campaign, wallet). Deterministic so a duplicate insert
 * collides at the DB unique index. Lowercased wallet — case never splits a person.
 */
export function dedupeKey(campaignId: string, wallet: string): string {
  return keccak256(toBytes(`${campaignId}:${wallet.toLowerCase()}`));
}

/**
 * The deterministic intent hash for a submission's payout — mirrors
 * bountyIntentHash so the settle cascade is idempotent and a settled event can
 * be matched back to its submission.
 */
export function submissionIntentHash(
  campaignId: string,
  submissionId: string,
): Hash {
  return keccak256(
    toBytes(`campaign:${campaignId}:${submissionId}`),
  ) as Hash;
}

/** Unix seconds (our timestamp unit across the schema). */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
