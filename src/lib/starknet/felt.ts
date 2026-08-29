/**
 * FITTING SAGE'S IDENTIFIERS INTO A FELT.
 *
 * Shared deliberately. The founder's browser writes a mission's terms into the vault under some
 * felt, and months later Sage asks the vault to pay for that mission under a felt it derives
 * independently. If the two derivations ever disagree the vault answers NO_SUCH_MISSION — and it
 * does so AFTER a worker has already done the work, which is the worst moment to discover a
 * mismatch. Two copies of this arithmetic is two chances to drift; there is one.
 */

/**
 * Fit a 256-bit hash into a felt252.
 *
 * The commitment path derives its ids and digests with keccak256, which is 256 bits — four bits
 * wider than a felt can hold. Passing one straight through would overflow and either revert or,
 * worse, silently wrap to a different value on each side.
 *
 * Clearing the top four bits is deterministic, keeps 252 bits of the original digest, and — the
 * part that matters — is applied identically wherever it is used, so the on-chain replay guarantee
 * still holds: the same authorisation maps to the same felt, and two different authorisations
 * still map to different ones.
 */
export const FELT_MASK = (BigInt(1) << BigInt(252)) - BigInt(1);

export const toFelt = (v: string): string => `0x${(BigInt(v) & FELT_MASK).toString(16)}`;

/** A campaign id is a string; a legacy campaign's implicit mission is keyed by its hash. */
export const feltOf = (s: string): string => {
  let h = BigInt(0);
  for (const ch of s) h = (h * BigInt(31) + BigInt(ch.charCodeAt(0))) & FELT_MASK;
  return `0x${h.toString(16)}`;
};

/**
 * The felt a mission's terms are stored under, from the two places that need it.
 *
 * `missionIdHash` when the plan has one, falling back to the campaign id exactly as settlement
 * does. Callers must not reimplement this fallback: settlement's choice is the one that has to win,
 * because settlement is what pays.
 */
export const missionFelt = (missionIdHash: string | null | undefined, campaignId: string): string =>
  toFelt(missionIdHash ?? feltOf(campaignId));

/**
 * Do two Starknet addresses denote the same account?
 *
 * Client-safe, unlike `sameFounder`, which lives in a `server-only` module. Same rule: a felt has
 * many valid spellings that differ only in leading zeros, and a wallet may hand back either — so
 * string equality would call one account two.
 */
export const sameFelt = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const norm = (v: string | null | undefined): string | null => {
    const t = v?.trim().toLowerCase();
    if (!t || !/^0x[0-9a-f]+$/.test(t)) return null;
    const stripped = t.slice(2).replace(/^0+/, "");
    return stripped && stripped.length <= 63 ? stripped : null;
  };
  const na = norm(a);
  return na !== null && na === norm(b);
};
