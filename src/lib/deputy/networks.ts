import { defineChain, type Address, type Chain } from "viem";

/**
 * The chain registry — keyed by chainId, the single source of truth for every
 * network the Deputy operates on. This is what lets one Deputy run vaults on
 * BOTH Metis Sepolia (testnet) and GOAT mainnet (real money) at once: a
 * campaign carries its `chainId`, and every read/write resolves its config here.
 *
 * NOT `server-only` — the display fields (name, chip label, explorer URL) are
 * public and rendered in client UI (network chips, explorer links). RPC URLs
 * read from env for server use; on the client those env vars are absent and the
 * public defaults stand in (never used client-side). No secret lives here.
 *
 * 59902 is the fallback everywhere, so every pre-existing single-network path is
 * untouched when no chainId is supplied.
 */

export type GasStrategy = "legacy" | "eip1559-fallback";

export interface ChainConfig {
  chainId: number;
  /** stable slug for logs/keys. */
  key: string;
  /** full network name. */
  name: string;
  /** short label for the UI network chip. */
  chipLabel: string;
  rpcUrl: string;
  explorerUrl: string;
  /** settlement token (USDC); null until deployed (Sepolia MockUSDC via env). */
  usdcAddress: Address | null;
  nativeSymbol: string;
  nativeName: string;
  isMainnet: boolean;
  /**
   * How to price a write: Metis settles at a fixed gas price (legacy, no
   * EIP-1559); GOAT is tried as EIP-1559 first and falls back to legacy.
   */
  gas: GasStrategy;
}

/** The default chain for any read/write that doesn't specify one. */
export const DEFAULT_CHAIN_ID = 59902;

/** GOAT mainnet USDC (6 decimals) — the real settlement token. */
export const GOAT_USDC = "0x3022b87ac063DE95b1570F46f5e470F8B53112D8" as Address;

export const CHAINS: Record<number, ChainConfig> = {
  59902: {
    chainId: 59902,
    key: "metis-sepolia",
    name: "Metis Sepolia",
    chipLabel: "Metis Sepolia",
    rpcUrl: process.env.METIS_SEPOLIA_RPC ?? "https://sepolia.metisdevops.link",
    explorerUrl: "https://sepolia-explorer.metisdevops.link",
    usdcAddress: (process.env.NEXT_PUBLIC_USDC_ADDRESS as Address | undefined) ?? null,
    nativeSymbol: "METIS",
    nativeName: "Metis",
    isMainnet: false,
    gas: "legacy",
  },
  1088: {
    chainId: 1088,
    key: "metis-andromeda",
    name: "Metis Andromeda",
    chipLabel: "Metis Andromeda",
    rpcUrl: process.env.METIS_RPC ?? "https://andromeda.metis.io/?owner=1088",
    explorerUrl: "https://andromeda-explorer.metis.io",
    usdcAddress: "0xEA32A96608495e54156Ae48931A7c20f0dcc1a21" as Address,
    nativeSymbol: "METIS",
    nativeName: "Metis",
    isMainnet: true,
    gas: "legacy",
  },
  2345: {
    chainId: 2345,
    key: "goat",
    name: "GOAT Network",
    chipLabel: "GOAT Mainnet",
    rpcUrl: process.env.GOAT_RPC_URL ?? "https://rpc.goat.network",
    explorerUrl: "https://explorer.goat.network",
    usdcAddress: GOAT_USDC,
    nativeSymbol: "BTC",
    nativeName: "Bitcoin",
    isMainnet: true,
    gas: "eip1559-fallback",
  },
};

/** Resolve a chain's config; unknown or missing chainId → the default (59902). */
export function chainConfig(chainId?: number | null): ChainConfig {
  if (chainId != null && CHAINS[chainId]) return CHAINS[chainId];
  return CHAINS[DEFAULT_CHAIN_ID];
}

/** Whether a chainId is one the Deputy is configured to operate on. */
export function isSupportedChain(chainId: number): boolean {
  return chainId in CHAINS;
}

/** A verifiable block-explorer link for a tx on the given chain. */
export function explorerTxUrl(chainId: number | null | undefined, txHash: string): string {
  return `${chainConfig(chainId).explorerUrl}/tx/${txHash}`;
}

/** A verifiable block-explorer link for an address on the given chain. */
export function explorerAddressUrl(chainId: number | null | undefined, address: string): string {
  return `${chainConfig(chainId).explorerUrl}/address/${address}`;
}

/** The chip label for the given chain (UI network chip). */
export function chainLabel(chainId?: number | null): string {
  return chainConfig(chainId).chipLabel;
}

/** Build a viem Chain for the given chainId — shared by read + write clients. */
export function viemChainFor(chainId: number): Chain {
  const c = chainConfig(chainId);
  return defineChain({
    id: c.chainId,
    name: c.name,
    nativeCurrency: { name: c.nativeName, symbol: c.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: [c.rpcUrl] } },
    blockExplorers: { default: { name: `${c.name} Explorer`, url: c.explorerUrl } },
    testnet: !c.isMainnet,
  });
}
