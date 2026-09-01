import "server-only";

/**
 * Starknet settlement configuration.
 *
 * Follows the same rule as the rest of Sage's integrations: a MISSING value means this rail is
 * pending and the product degrades honestly to the chains it already settles on; a MALFORMED value
 * fails where it is used rather than being silently coerced into something that looks plausible.
 * A half-configured money rail is worse than an absent one — it fails on a worker's payout instead
 * of at boot.
 */

/**
 * Native USDC on Starknet mainnet — Circle's own Cairo 1 token, 6 decimals.
 *
 * NOT `0x053c9125…`, which is the older StarkGate-bridged "USD Coin". Both are called USDC, both
 * have 6 decimals, and both are real; they are simply different tokens with different balances.
 * Escrowing against the wrong one reverts at `transfer_from` with an empty-balance error that says
 * nothing about the actual cause, so the address is pinned here and overridable by env.
 */
const MAINNET_USDC = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";

/** starkli 0.4.2 and sncast both fail against newer nodes; starknet.js works with this one. */
const DEFAULT_RPC = "https://rpc.starknet.lava.build:443";

export interface StarknetConfig {
  rpcUrl: string;
  /** The deployed `SageClaims` contract. */
  claimsAddress: string;
  /** The settlement token. USDC unless explicitly overridden. */
  tokenAddress: string;
  /** Sage's own account — funds deposits and relays gas for claimants. */
  accountAddress: string;
  privateKey: string;
}

const clean = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** A Starknet address is a felt: 0x followed by up to 64 hex digits. */
const isAddress = (v: string): boolean => /^0x[0-9a-fA-F]{1,64}$/.test(v);

/**
 * The resolved config, or null when this rail is not set up.
 *
 * Every field is required together, for the same reason an LLM lane is: a partial configuration
 * would sign with one deployment's key against another's contract, and the failure would land on a
 * founder's payout rather than at startup.
 */
export function starknetConfig(): StarknetConfig | null {
  const rpcUrl = clean(process.env.STARKNET_RPC_URL);
  const claimsAddress = clean(process.env.STARKNET_CLAIMS_ADDRESS);
  const accountAddress = clean(process.env.STARKNET_ACCOUNT_ADDRESS);
  const privateKey = clean(process.env.STARKNET_PRIVATE_KEY);
  const tokenAddress = clean(process.env.STARKNET_USDC_ADDRESS) ?? MAINNET_USDC;

  if (!rpcUrl || !claimsAddress || !accountAddress || !privateKey) return null;

  // Shape is checked even though presence is optional: a truncated address would otherwise become
  // a valid-looking call to the wrong contract.
  for (const [name, value] of [
    ["STARKNET_CLAIMS_ADDRESS", claimsAddress],
    ["STARKNET_ACCOUNT_ADDRESS", accountAddress],
    ["STARKNET_USDC_ADDRESS", tokenAddress],
  ] as const) {
    if (!isAddress(value)) throw new Error(`${name} is not a Starknet address: ${value}`);
  }
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(privateKey)) {
    throw new Error("STARKNET_PRIVATE_KEY is not a felt");
  }

  return { rpcUrl, claimsAddress, tokenAddress, accountAddress, privateKey };
}

export const starknetConfigured = (): boolean => {
  try {
    return starknetConfig() !== null;
  } catch {
    // Malformed is not the same as absent, and must not read as "configured".
    return false;
  }
};

/** Everything needed to READ the chain — no credential among them. */
export interface StarknetReadConfig {
  claims: string;
  token: string;
  rpcUrl: string;
}

/**
 * Just the PUBLIC configuration — the deployed contract and the settlement token.
 *
 * Separate from `starknetConfig()` on purpose. That one requires the signing key because it exists
 * to send transactions; this one exists so a page can name a contract. A claim page should not be
 * unable to render because a secret is absent, and tying the two together would mean exactly that.
 */
export function starknetAddresses(): StarknetReadConfig | null {
  const claims = clean(process.env.STARKNET_CLAIMS_ADDRESS);
  if (!claims) return null;
  const token = clean(process.env.STARKNET_USDC_ADDRESS) ?? MAINNET_USDC;
  if (!isAddress(claims) || !isAddress(token)) return null;
  return { claims, token, rpcUrl: clean(process.env.STARKNET_RPC_URL) ?? DEFAULT_RPC };
}

/**
 * The declared `SageVault` class, which founders deploy their own copy of.
 *
 * Absent means private-capable campaigns are not available on this deployment — the founder is
 * told so plainly rather than being walked into a flow that cannot finish. Present but malformed
 * throws, because a wrong class hash would deploy something that is not a vault, or nothing at all,
 * after the founder has already signed away the funding in the same transaction.
 */
export function starknetVaultClassHash(): string | null {
  const v = clean(process.env.STARKNET_VAULT_CLASS_HASH);
  if (!v) return null;
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(v)) {
    throw new Error(`STARKNET_VAULT_CLASS_HASH is not a class hash: ${v}`);
  }
  return v;
}

/**
 * EVERY CLASS SAGE HAS DECLARED — the deploy target first, then the previous ones.
 *
 * Provenance ("is this vault Sage's code?") used to compare a vault against the ONE class in
 * `STARKNET_VAULT_CLASS_HASH`. Declaring the privacy class (2026-09-02) made that a trap: the
 * moment new campaigns deploy from the new class, the three live vaults on the previous class
 * would read as "not a Sage vault" — payouts refused at the receipt check, the vault agreement,
 * and the proof page's provenance line, for vaults that are exactly Sage's code one revision
 * back. A vault is recognised if its class is ANY class Sage declared; new vaults still deploy
 * from the first entry only. Previous classes ride `STARKNET_VAULT_CLASS_HASHES_PREVIOUS`,
 * comma-separated; a malformed entry throws for the same reason a malformed target does.
 */
export function starknetKnownVaultClasses(): string[] {
  const target = starknetVaultClassHash();
  const previous = (clean(process.env.STARKNET_VAULT_CLASS_HASHES_PREVIOUS) ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  for (const v of previous) {
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(v)) {
      throw new Error(`STARKNET_VAULT_CLASS_HASHES_PREVIOUS has an entry that is not a class hash: ${v}`);
    }
  }
  const seen = new Set<bigint>();
  const out: string[] = [];
  for (const v of [target, ...previous]) {
    if (!v) continue;
    const n = BigInt(v);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(v);
  }
  return out;
}

/** Is `actualClass` (as read from the chain) one of Sage's declared vault classes? */
export function isSageVaultClass(actualClass: string, known: string[] = starknetKnownVaultClasses()): boolean {
  const n = BigInt(actualClass);
  return known.some((k) => BigInt(k) === n);
}
