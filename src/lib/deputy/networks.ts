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
 * Arc — Circle's chain. USDC is the NATIVE gas token there (18 decimals at the gas layer) and also
 * answers as an ERC-20 at this fixed address with 6 decimals: one balance, two faces. Every amount
 * Sage stores is 6-decimal base units and every token call goes through the ERC-20 face, so the two
 * precisions never meet in code. The founder-facing consequence: funding a wallet with USDC IS
 * funding its gas — no second token to find, which is why Arc becomes the default rail the day its
 * mainnet opens (see DEFAULT_EVM_LAUNCH_CHAIN).
 */
export const ARC_USDC = "0x3600000000000000000000000000000000000000" as Address;
export const ARC_TESTNET_CHAIN_ID = 5042002;
/** Arc mainnet, open since 16 September 2026. Same USDC address and precision as the testnet
 *  (read by `eth_call` on 26 Sep: `decimals()` 6, `symbol()` "USDC"). */
export const ARC_MAINNET_CHAIN_ID = 5042;

/** Either Arc network: USDC is the gas on both, and one operator identity serves both. */
export function isArcChain(chainId: number | null | undefined): boolean {
  return chainId === ARC_MAINNET_CHAIN_ID || chainId === ARC_TESTNET_CHAIN_ID;
}

/**
 * The EVM chain new launches default to: GOAT mainnet, the chain the product runs real money on.
 *
 * Arc was on TESTNET until 16 September 2026, and a mainnet product must not present a testnet as its
 * default — the founder's rule of 2026-09-10: "keep it separate and keep strk20 and goat primary,
 * until we goes mainnet". Arc mainnet joined the registry on 26 Sep as the explicit choice. The flip
 * that makes it the default ("arc default, goat behind an explicit choice but the history stays") is
 * held until Future Caribbean's judging closes, so the product under review does not change beneath
 * the judges. Nothing about a campaign already on either chain changes with the flip.
 */
export const DEFAULT_EVM_LAUNCH_CHAIN = GOAT_MAINNET_CHAIN_ID;

/** The Arc rail a founder may pick explicitly: Arc mainnet. The testnet stays in the registry, so
 *  campaigns and accounts already on it keep working, but it is no longer offered to anyone new. */
export const ARC_LAUNCH_CHAIN = ARC_MAINNET_CHAIN_ID;

/** The env-name prefix for a chain's deploy-time addresses and operator key (`<PREFIX>_CAMPAIGN_FACTORY_ADDRESS`, …). */
export function railEnvPrefix(chainId: number): "ARC_MAINNET" | "ARC" | "GOAT" | "METIS" {
  return chainId === ARC_MAINNET_CHAIN_ID ? "ARC_MAINNET" : chainId === ARC_TESTNET_CHAIN_ID ? "ARC" : chainId === 2345 ? "GOAT" : "METIS";
}

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
    rpcUrl: "https://starknet-rpc.publicnode.com",
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
  5042: {
    chainId: 5042,
    key: "arc",
    name: "Arc",
    chipLabel: "Arc Mainnet",
    rpcUrl: process.env.ARC_MAINNET_RPC_URL ?? "https://rpc.mainnet.arc.io",
    explorerUrl: "https://explorer.arc.io",
    usdcAddress: ARC_USDC,
    nativeSymbol: "USDC",
    nativeName: "USDC",
    isMainnet: true,
    evm: true,
    gas: "eip1559-fallback",
  },
  5042002: {
    chainId: 5042002,
    key: "arc-testnet",
    name: "Arc Testnet",
    chipLabel: "Arc Testnet",
    rpcUrl: process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io",
    explorerUrl: "https://testnet.arcscan.app",
    usdcAddress: ARC_USDC,
    nativeSymbol: "USDC",
    nativeName: "USDC",
    isMainnet: false,
    evm: true,
    gas: "eip1559-fallback",
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

/**
 * REAL MONEY — whether a chain settles real USDC. The one test every record, public total and receipt
 * count uses ("no testnet thing", 10 Oct 2026): a testnet payout is a real transaction that moves no
 * real money, so it is never income and never part of a settlement total. Unknown or missing → false
 * (chainConfig would fall back to the default testnet, which is the same answer).
 */
export function isMainnetChain(chainId: number | null | undefined): boolean {
  return chainId != null && chainId in CHAINS && CHAINS[chainId].isMainnet;
}

/** Every registry chain that settles real money — for queries that filter rows by chain id. */
export function mainnetChainIds(): number[] {
  return Object.keys(CHAINS).map(Number).filter((id) => CHAINS[id].isMainnet);
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
