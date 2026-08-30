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

export function readClaimSignature(rail: "evm" | "starknet", raw: unknown): ClaimSignature | null {
  if (rail === "starknet") {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    // Every element must be a felt-shaped string. A wallet that returns numbers, or a caller
    // padding the array with nulls, must not reach the account contract as a "signature".
    if (!raw.every((p) => typeof p === "string" && /^(0x)?[0-9a-fA-F]{1,64}$/.test(p.trim()))) return null;
    return { rail: "starknet", signature: raw.map((p) => String(p).trim()) };
  }
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]+$/.test(raw)) return null;
  return { rail: "evm", signature: raw as `0x${string}` };
}
