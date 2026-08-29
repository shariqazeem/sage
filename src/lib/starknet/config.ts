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

/** Canonical USDC on Starknet mainnet. Overridable so a testnet deploy can point elsewhere. */
const MAINNET_USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

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
