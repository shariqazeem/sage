import "server-only";

import { getSessionAddress } from "./session";
import { getStarknetSessionAddress } from "./starknet-session";

/**
 * WHO THE FOUNDER IS, WITHOUT ASSUMING WHICH CHAIN THEY CAME FROM.
 *
 * Sage was built EVM-first and its SIWE session quietly became the account system. Nobody decided
 * that founders must own an Ethereum wallet — it simply fell out of the order things were built
 * in. The cost was real: a founder arriving with a Starknet wallet could not launch at all, even
 * for a campaign that settles entirely on Starknet, because identity and settlement had been
 * fused when only one chain existed.
 *
 * They are separate concerns, and only identity was hardcoded. A campaign's vault is owned by the
 * wallet that funds it either way; this decides only whose account a plan belongs to.
 *
 * ONE COMPARISON, USED EVERYWHERE. Ownership was checked with `a.toLowerCase() === b.toLowerCase()`
 * in a dozen places. That is correct for an EVM address and WRONG for a Starknet one: the same
 * felt has many valid spellings differing only in leading zeros, and a wallet may hand back either.
 * String equality would then admit a founder to their own campaign on Monday and lock them out on
 * Tuesday, with nothing in a log to explain it. `sameFounder` is the only comparison anything
 * should use.
 */

/**
 * The canonical form an address is stored and compared in: lower case, no leading zeros.
 *
 * Both families collapse under the same rule, which is what lets one comparison serve both. Note
 * the consequence honestly: an EVM address and a Starknet address of the same NUMERIC value would
 * compare equal. Reaching that requires a Starknet account below 2^160, and its address is a
 * Poseidon hash the attacker can only grind — about 2^92 work for the cheapest version. It is not
 * a door anyone walks through, but it is a door, and it should be written down rather than found.
 */
export function normalizeFounder(raw: string | null | undefined): string | null {
  const t = raw?.trim().toLowerCase();
  if (!t || !/^0x[0-9a-f]+$/.test(t)) return null;
  const stripped = t.slice(2).replace(/^0+/, "");
  // A felt is below 2^252, so 63 significant hex digits is the ceiling; an EVM address is 40.
  if (!stripped || stripped.length > 63) return null;
  return `0x${stripped}`;
}

/** Is this the same founder, whichever chain either spelling came from? */
export function sameFounder(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeFounder(a);
  const nb = normalizeFounder(b);
  return na !== null && na === nb;
}

/**
 * The form an address is WRITTEN TO and QUERIED FROM the database in.
 *
 * Distinct from `normalizeFounder`, and deliberately so. Comparison can strip padding from both
 * sides at once; an indexed SQL equality cannot — it matches bytes, so the stored form and the
 * queried form must already agree.
 *
 * EVM ADDRESSES ARE LEFT EXACTLY AS THEY WERE: lower-cased, padding intact. Every existing row was
 * written that way, and about one address in sixteen begins with a zero — stripping them now would
 * quietly orphan those founders' jobs behind a lookup that no longer matches. Only Starknet
 * addresses, which have no rows yet and genuinely need it, are canonicalised.
 */
export function founderStorageKey(raw: string): string {
  const t = raw.trim().toLowerCase();
  // 42 characters is `0x` plus a 20-byte EVM address; anything longer is a felt.
  if (t.length <= 42) return t;
  return normalizeFounder(t) ?? t;
}

/** Which family an address belongs to. Used for display and for picking a settlement rail. */
export function founderChain(raw: string | null | undefined): "evm" | "starknet" | null {
  const n = normalizeFounder(raw);
  if (!n) return null;
  // 40 significant hex digits is an EVM address; a Starknet account address is far longer. This
  // is a display hint, never an authorisation decision — `sameFounder` never consults it.
  return n.length <= 42 ? "evm" : "starknet";
}

/**
 * The signed-in founder, from EITHER session.
 *
 * The EVM session is preferred when both exist, so a founder who has used Sage before keeps the
 * account their existing campaigns are already filed under — switching them to a Starknet identity
 * because a second cookie happened to be present would orphan their history.
 */
export async function getFounderAddress(): Promise<string | null> {
  const evm = await getSessionAddress();
  if (evm) return normalizeFounder(evm);
  return normalizeFounder(await getStarknetSessionAddress());
}

/** The founder plus which chain they signed in from, for surfaces that must show or branch on it. */
export async function getFounderIdentity(): Promise<{
  address: string;
  chain: "evm" | "starknet";
} | null> {
  const address = await getFounderAddress();
  if (!address) return null;
  const chain = founderChain(address);
  return chain ? { address, chain } : null;
}
