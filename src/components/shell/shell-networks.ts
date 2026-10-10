import { ARC_LAUNCH_CHAIN, DEFAULT_EVM_LAUNCH_CHAIN, STARKNET_MAINNET_KEY } from "@/lib/deputy/networks";

/**
 * THE NETWORKS THE APP SHELL NAMES — every network this sign-in can settle on, and nothing else.
 *
 * An Ethereum sign-in settles on GOAT and on Arc, one account per network, so naming only the default
 * read "GOAT Mainnet" over a founder launching on Arc (10 Oct 2026). A Starknet sign-in settles on
 * Starknet alone. Signed out, the visitor is told all three. Mainnets only: a testnet is never named
 * here, whatever chain a browser wallet happens to sit on.
 */
export function shellNetworks(chain: "evm" | "starknet" | null): number[] {
  const evm = [...new Set([DEFAULT_EVM_LAUNCH_CHAIN, ARC_LAUNCH_CHAIN])];
  if (chain === "starknet") return [STARKNET_MAINNET_KEY];
  if (chain === "evm") return evm;
  return [...evm, STARKNET_MAINNET_KEY];
}
