import { CHAINS, PRIMARY_NETWORKS } from "@/lib/deputy/networks";

/**
 * CHAINS SAGE CAN READ A WORKER'S PROOF ON: pay on Metis, verify work done anywhere.
 *
 * Sage pays on its own network, but the work it pays for often happens elsewhere: a swap on a DEX on
 * Base, a Safe deployed on Arbitrum, a contract verified on Ethereum, a bug bash on a testnet. On-chain
 * proof was only readable on Sage's own launch networks. Sage Bench (5 Nov 2026) drafted a doc instead of
 * a transaction for 13 on-chain jobs, because the transaction could never have been checked.
 *
 * These entries are READ-ONLY: a public RPC to look up a transaction or read a contract. Nothing launches
 * here, nothing is paid here, and none of them appear as a network a founder can choose. Testnets are
 * listed because a bug bash is real work done on one. They are never a place Sage holds money.
 */
export interface VerifyChain {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  testnet: boolean;
}

const env = (k: string) => process.env[k]?.trim() || undefined;

export const VERIFY_ONLY_CHAINS: Record<number, VerifyChain> = {
  1: { chainId: 1, name: "Ethereum", rpcUrl: env("VERIFY_RPC_1") ?? "https://ethereum-rpc.publicnode.com", explorerUrl: "https://etherscan.io", testnet: false },
  8453: { chainId: 8453, name: "Base", rpcUrl: env("VERIFY_RPC_8453") ?? "https://mainnet.base.org", explorerUrl: "https://basescan.org", testnet: false },
  42161: { chainId: 42161, name: "Arbitrum One", rpcUrl: env("VERIFY_RPC_42161") ?? "https://arb1.arbitrum.io/rpc", explorerUrl: "https://arbiscan.io", testnet: false },
  10: { chainId: 10, name: "OP Mainnet", rpcUrl: env("VERIFY_RPC_10") ?? "https://mainnet.optimism.io", explorerUrl: "https://optimistic.etherscan.io", testnet: false },
  137: { chainId: 137, name: "Polygon", rpcUrl: env("VERIFY_RPC_137") ?? "https://polygon-bor-rpc.publicnode.com", explorerUrl: "https://polygonscan.com", testnet: false },
  56: { chainId: 56, name: "BNB Chain", rpcUrl: env("VERIFY_RPC_56") ?? "https://bsc-dataseed.bnbchain.org", explorerUrl: "https://bscscan.com", testnet: false },
  43114: { chainId: 43114, name: "Avalanche C-Chain", rpcUrl: env("VERIFY_RPC_43114") ?? "https://api.avax.network/ext/bc/C/rpc", explorerUrl: "https://snowtrace.io", testnet: false },
  59144: { chainId: 59144, name: "Linea", rpcUrl: env("VERIFY_RPC_59144") ?? "https://rpc.linea.build", explorerUrl: "https://lineascan.build", testnet: false },
  534352: { chainId: 534352, name: "Scroll", rpcUrl: env("VERIFY_RPC_534352") ?? "https://rpc.scroll.io", explorerUrl: "https://scrollscan.com", testnet: false },
  11155111: { chainId: 11155111, name: "Sepolia (testnet)", rpcUrl: env("VERIFY_RPC_11155111") ?? "https://ethereum-sepolia-rpc.publicnode.com", explorerUrl: "https://sepolia.etherscan.io", testnet: true },
  84532: { chainId: 84532, name: "Base Sepolia (testnet)", rpcUrl: env("VERIFY_RPC_84532") ?? "https://sepolia.base.org", explorerUrl: "https://sepolia.basescan.org", testnet: true },
  421614: { chainId: 421614, name: "Arbitrum Sepolia (testnet)", rpcUrl: env("VERIFY_RPC_421614") ?? "https://sepolia-rollup.arbitrum.io/rpc", explorerUrl: "https://sepolia.arbiscan.io", testnet: true },
  59902: { chainId: 59902, name: "Metis Sepolia (testnet)", rpcUrl: env("VERIFY_RPC_59902") ?? "https://sepolia.metisdevops.link", explorerUrl: "https://sepolia-explorer.metisdevops.link", testnet: true },
};

/**
 * The read endpoint for verifying a proof on `chainId`: Sage's own EVM network when it is one, else a
 * verify-only chain, else null (Starknet and anything unknown can't be checked this way).
 */
export function verifyChain(chainId: number): { name: string; rpcUrl: string } | null {
  const own = CHAINS[chainId];
  if (own?.evm) return { name: own.name, rpcUrl: own.rpcUrl };
  const v = VERIFY_ONLY_CHAINS[chainId];
  return v ? { name: v.name, rpcUrl: v.rpcUrl } : null;
}

/** Every chain a proof may be read on, for the drafter and the card: name and id. */
export function verifiableChainList(): { chainId: number; name: string }[] {
  // Sage's own open network first (paused and closed networks are offered nowhere, here included)
  const own = PRIMARY_NETWORKS.map((id) => CHAINS[id]).filter((c) => c?.evm).map((c) => ({ chainId: c!.chainId, name: c!.name }));
  const extra = Object.values(VERIFY_ONLY_CHAINS).map((c) => ({ chainId: c.chainId, name: c.name }));
  const seen = new Set<number>();
  return [...own, ...extra].filter((c) => (seen.has(c.chainId) ? false : (seen.add(c.chainId), true)));
}
