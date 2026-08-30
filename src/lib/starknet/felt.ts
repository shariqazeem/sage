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
 * Fit a 256-bit hash into a felt.
 *
 * The commitment path derives its ids and digests with keccak256, which is 256 bits — wider than a
 * felt can hold. Passing one straight through would overflow and either revert or, worse, silently
 * wrap to a different value on each side.
 *
 * MASKING TO 252 BITS WAS NOT ENOUGH, which is a genuinely easy thing to get wrong: "felt252"
 * names the type but not the bound. The field prime is 2^251 + 17·2^192 + 1 — barely above 2^251 —
 * so a 252-bit value can be almost TWICE the prime and still look like it fits. A real mission id
 * came out at 1.92× the prime, and Ready refused the whole deployment with "Default Felt
 * constructor accepts values smaller than Felt.PRIME" while a founder was trying to fund a vault.
 *
 * 251 bits is always below the prime, needs no modular arithmetic, and stays what it has to be:
 * deterministic and applied identically wherever it is used, so the on-chain replay guarantee still
 * holds — the same authorisation maps to the same felt, and two different authorisations still map
 * to different ones.
 */
export const STARKNET_PRIME = (BigInt(1) << BigInt(251)) + BigInt(17) * (BigInt(1) << BigInt(192)) + BigInt(1);
export const FELT_MASK = (BigInt(1) << BigInt(251)) - BigInt(1);

/**
 * Is this value already a valid felt — i.e. can the chain take it unchanged?
 *
 * Distinct from `toFelt`, which REDUCES. Callers that hand a value straight to calldata need to
 * know whether it fits, because an oversized one is not rejected: it is reduced modulo PRIME by
 * the chain, which is a different number from `toFelt`'s mask, and the two would key the same
 * mission under two different ids.
 */
export const isFelt = (v: string | null | undefined): boolean => {
  if (!v || !/^0x[0-9a-fA-F]+$/.test(v.trim())) return false;
  try {
    const n = BigInt(v.trim());
    return n >= BigInt(0) && n < STARKNET_PRIME;
  } catch {
    return false;
  }
};

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
