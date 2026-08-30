/**
 * READING THE SIGNATURE OFF A SUBMISSION — one shape per rail, decided in one place.
 *
 * An EVM signature is a single hex string, recovered to an address. A Starknet signature is an
 * ARRAY of felts, and there is nothing to recover to: the account contract validates it.
 *
 * This exists as its own function because the two casts it replaces were the only thing standing
 * between a Starknet recipient and a 400. The route required `typeof signature === "string"`, so
 * an array — the only shape a Starknet wallet can return — was rejected before any verifier ran,
 * with "A signed evidence commitment is required" as the explanation for a commitment that was
 * signed correctly.
 */
export type ClaimSignature =
  | { rail: "evm"; signature: `0x${string}` }
  | { rail: "starknet"; signature: string[] };

/** Starknet's field prime. A signature element is a felt, so it is a NUMBER below this. */
const STARKNET_PRIME = (BigInt(1) << BigInt(251)) + BigInt(17) * (BigInt(1) << BigInt(192)) + BigInt(1);

/**
 * Is this one felt of a signature?
 *
 * Judged NUMERICALLY, not by string shape. The first version required
 * `/^(0x)?[0-9a-fA-F]{1,64}$/`, which is a HEX assumption — and Starknet wallets return signature
 * elements as DECIMAL, where a felt runs to 76 digits and blows straight past a 64-character cap.
 *
 * REPORTED from the live campaign: Ready displayed the commitment correctly, the tester signed it,
 * and the server answered "A signed evidence commitment is required" about a signature it had just
 * been handed. Accepting both spellings is the point — a felt has many, and which one arrives is
 * the wallet's choice, not ours.
 */
const isSignatureFelt = (v: unknown): boolean => {
  // A JS number cannot hold a felt: anything above 2^53 has already lost precision by the time it
  // reaches here, so a number is either corrupted or was never a signature element.
  if (typeof v !== "string" && typeof v !== "bigint") return false;
  const t = String(v).trim();
  // `0x`-prefixed hex, or pure decimal. BARE hex containing letters ("3c4d") is refused because it
  // is genuinely ambiguous — "12345" is a valid spelling of both, and reading a hex felt as decimal
  // silently produces a different number. A wallet that means hex says 0x.
  if (!/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(t)) return false;
  try {
    const n = BigInt(t);
    return n >= BigInt(0) && n < STARKNET_PRIME;
  } catch {
    return false;
  }
};

export function readClaimSignature(rail: "evm" | "starknet", raw: unknown): ClaimSignature | null {
  if (rail === "starknet") {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    // A caller padding the array with nulls, or a wallet handing back something that is not a
    // felt at all, must not reach the account contract as a "signature".
    if (!raw.every(isSignatureFelt)) return null;
    return { rail: "starknet", signature: raw.map((p) => String(p).trim()) };
  }
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]+$/.test(raw)) return null;
  return { rail: "evm", signature: raw as `0x${string}` };
}
