/**
 * COMPARING IDENTIFIERS THAT MAY HAVE PASSED THROUGH A FELT.
 *
 * Sage derives campaign ids, mission ids and plan digests with keccak256 — 256 bits. A Cairo
 * contract stores a felt, which is 251. So a Starknet vault holds the REDUCTION of exactly the
 * digest the database holds, and comparing the two as text calls them different.
 *
 * That mismatch was found twice, in two hand-written `eqHex` helpers that had no idea about each
 * other — the second only after the first was fixed and the founder hit the same wall one stage
 * later, with a different set of field names. One implementation, so there is no third.
 *
 * An EVM vault stores the full digest, so reducing both sides equally leaves those comparisons
 * exactly as they were. Two genuinely different digests colliding under this needs a 251-bit
 * coincidence.
 *
 * USE THIS ONLY WHERE ONE SIDE CAME OFF A CHAIN. `vault-strategy.ts` compares Sage's own
 * derivations against each other — an attempt's mission id against the plan's, a settlement's
 * intent hash against the one authorised — and neither has been through a felt. Reducing there
 * would widen a replay guard for no reason, so it deliberately keeps a plain comparison.
 */

/** The largest value a felt can hold, as a mask. */
export const FIELD_MASK = (BigInt(1) << BigInt(251)) - BigInt(1);

/** The form an identifier takes once a Cairo contract has stored it. */
export const toFieldHash = (hash: string): string => {
  try {
    return `0x${(BigInt(hash) & FIELD_MASK).toString(16)}`;
  } catch {
    return hash.toLowerCase();
  }
};

/** Are these the same identifier, allowing for one of them having been through a felt? */
export const sameFieldHash = (a?: string | null, b?: string | null): boolean => {
  if (a == null || b == null) return false;
  try {
    return (BigInt(a) & FIELD_MASK) === (BigInt(b) & FIELD_MASK);
  } catch {
    // Not both hex — fall back to the text comparison this replaced, so a non-hash identifier
    // behaves as it always did rather than silently matching.
    return a.toLowerCase() === b.toLowerCase();
  }
};
