import { getAddress, isAddress } from "viem";

import { chainConfig } from "@/lib/deputy/networks";

/**
 * ONE ADDRESS RULE FOR BOTH FAMILIES, so the campaign path can be shared rather than forked.
 *
 * The V2 attach path — the one that wires a campaign's private corpus, verifies the vault agrees
 * with the database, and checks the public identity invariant — was written when every chain was
 * an EVM chain. It calls viem's `getAddress` on the vault, the founder and the token, and viem
 * rejects a felt.
 *
 * That single incompatibility is why the Starknet rail hand-rolled its own campaign creation and
 * shipped without a corpus, without a marketplace listing and without either check. The fix is to
 * teach this path both address families, not to keep a second, thinner path beside it.
 */

/** Checksum an EVM address; canonicalise a felt. Throws on anything that is neither. */
export function normalizeForChain(address: string, chainId: number): string {
  if (chainConfig(chainId).evm) return getAddress(address);
  const t = address.trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(t)) throw new Error(`not a Starknet address: ${address}`);
  const stripped = t.slice(2).replace(/^0+/, "");
  if (!stripped || stripped.length > 63) throw new Error(`not a Starknet address: ${address}`);
  return `0x${stripped}`;
}

/** Is this a valid address on this chain? Never throws. */
export function isChainAddress(address: string, chainId: number): boolean {
  if (chainConfig(chainId).evm) return isAddress(address);
  try {
    normalizeForChain(address, chainId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Do two addresses denote the same account, on either family?
 *
 * Replaces a lower-cased string comparison, which is right for an EVM address and wrong for a
 * felt: the same Starknet address has many spellings differing only in leading zeros, so string
 * equality would report a vault's real owner as a mismatch and refuse a correctly funded campaign.
 * Stripping leading zeros is a no-op for a fixed-width EVM address, so this is byte-identical in
 * behaviour there.
 */
export function sameChainAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (v: string | null | undefined): string | null => {
    const t = v?.trim().toLowerCase();
    if (!t || !/^0x[0-9a-f]*$/.test(t)) return null;
    const stripped = t.slice(2).replace(/^0+/, "");
    // "0x0" and "0x" both mean the zero address; keep them comparable rather than null, because
    // the agreement check legitimately compares a guardian against zero.
    return stripped.length > 63 ? null : stripped;
  };
  const na = norm(a);
  return na !== null && na === norm(b);
}
