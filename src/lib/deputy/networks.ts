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
  /** Endpoint used for BROADCASTING signed transactions, when it must differ from the read endpoint. */
  writeRpcUrl?: string;
  explorerUrl: string;
  /** settlement token (USDC); null until deployed (Sepolia MockUSDC via env). */
  usdcAddress: Address | null;
  nativeSymbol: string;
  nativeName: string;
  isMainnet: boolean;
  /**
   * Whether this is an EVM chain that viem can talk to.
   *
   * False for Starknet, which is here so that AMOUNTS, NETWORK LABELS AND EXPLORER LINKS are
   * truthful for campaigns settled on it — and for nothing else. Every write path (the signer, the
   * vault adapter, on-chain verification) is EVM-only and must filter on this rather than assume
   * every registry entry is reachable with an EVM client.
   */
  evm: boolean;
  /**
   * How to price a write: Metis settles at a fixed gas price (legacy, no
   * EIP-1559); GOAT is tried as EIP-1559 first and falls back to legacy.
   */
  gas: GasStrategy;
}

/** The default chain for any read/write that doesn't specify one. */
export const DEFAULT_CHAIN_ID = 59902;

/** GOAT Network mainnet — the real-money chain the product ships on (walletless always uses it; the
 *  web deploy lists it first). The launch flow labels currency against this, so a mainnet plan never
 *  shows testnet units. */
export const GOAT_MAINNET_CHAIN_ID = 2345;

/** GOAT mainnet USDC (6 decimals) — the real settlement token. */
export const GOAT_USDC = "0x3022b87ac063DE95b1570F46f5e470F8B53112D8" as Address;

/**
 * Registry key for Starknet mainnet. NOT an EVM chain id — Starknet has none, and its own
 * identifier (SN_MAIN, 0x534e5f4d41494e) exceeds JavaScript's safe integer range, so it cannot be
 * stored in the integer column this keys. It exists so a campaign settled on Starknet renders its
 * real USDC as money rather than as valueless test tokens, which is what happened when such a
 * campaign inherited the Metis Sepolia default.
 */
export const STARKNET_MAINNET_KEY = 900_001;

export const CHAINS: Record<number, ChainConfig> = {
  [900_001]: {
    chainId: 900_001,
    key: "starknet",
    name: "Starknet",
    chipLabel: "Starknet",
    // A Starknet RPC, unreachable by viem — kept truthful rather than blank, and guarded by `evm`.
    rpcUrl: "https://rpc.starknet.lava.build:443",
    explorerUrl: "https://starkscan.co",
    usdcAddress: null,
    nativeSymbol: "STRK",
    nativeName: "Starknet Token",
    isMainnet: true,
    evm: false,
    gas: "legacy",
  },
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
    evm: true,
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
    evm: true,
    gas: "legacy",
  },
  2345: {
    chainId: 2345,
    key: "goat",
    name: "GOAT Network",
    chipLabel: "GOAT Mainnet",
    rpcUrl: process.env.GOAT_RPC_URL ?? "https://rpc.goat.network",
    /**
     * READS AND WRITES CAN NEED DIFFERENT ENDPOINTS, and pretending otherwise cost real payouts.
     *
     * 2026-08-15/16: one backend behind `rpc.goat.network`'s anycast froze ten hours while claiming
     * `eth_syncing: false`, so reads from this host were a day stale. The explorer's JSON-RPC was
     * current and unblocked every read — then failed under load on the write path, and seven testers
     * who had cleared the bar could not be paid. Neither endpoint was good at both jobs.
     *
     * So the two are separable. `GOAT_WRITE_RPC_URL` broadcasts; `GOAT_RPC_URL` reads. Unset, they
     * are the same endpoint and behaviour is byte-identical to before.
     */
    writeRpcUrl: process.env.GOAT_WRITE_RPC_URL ?? undefined,
    explorerUrl: "https://explorer.goat.network",
    usdcAddress: GOAT_USDC,
    nativeSymbol: "BTC",
    nativeName: "Bitcoin",
    isMainnet: true,
    evm: true,
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

/**
 * The EVM chains, for anything that will reach for a viem client — deploying a vault, reading
 * logs, verifying an on-chain milestone. The registry now also holds Starknet, which is there for
 * truthful amounts and explorer links and is not reachable that way; offering it in a chain picker
 * would produce a campaign whose verification can never run.
 */
export function evmChains(): ChainConfig[] {
  return Object.values(CHAINS).filter((c) => c.evm);
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
