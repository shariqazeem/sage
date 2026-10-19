import { chainConfig, PRIMARY_NETWORKS, STARKNET_MAINNET_KEY } from "@/lib/deputy/networks";

/**
 * THE NETWORKS THE APP SHELL NAMES: the networks this sign-in settles on by default, from the network
 * policy (networks.ts), and nothing else.
 *
 * An Ethereum sign-in (wallet or email) settles on the PRIMARY networks, GOAT and Metis, one account each.
 * Signed out, the visitor sees the same primary pair. A Starknet sign-in settles on Starknet alone.
 * Secondary networks (Arc) are opt-in, so the shell does not advertise them, and testnets are never named.
 */
export function shellNetworks(chain: "evm" | "starknet" | null): number[] {
  if (chain === "starknet") return [STARKNET_MAINNET_KEY];
  return PRIMARY_NETWORKS.filter((id) => chainConfig(id).evm);
}
