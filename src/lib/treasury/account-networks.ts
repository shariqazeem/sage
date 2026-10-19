import { chainConfig, PRIMARY_NETWORKS, SECONDARY_NETWORKS } from "@/lib/deputy/networks";

/**
 * WHICH NETWORKS AN ACCOUNT PAGE SHOWS, from the network policy (networks.ts), so no page invents its own.
 *
 * - PRIMARY networks (GOAT, Metis) appear as soon as they are configured. The home network always does.
 * - SECONDARY networks (Arc) appear only when the founder already holds an account there (their money
 *   must stay reachable) or explicitly asked for one ("More networks").
 * - Anything else is never shown: a retired testnet, or a chain whose factory isn't configured.
 */
export function accountNetworks(input: { home: number; configured: readonly number[]; held: readonly number[]; asked?: number | null }): {
  primary: number[];
  secondary: number[];
  selected: number;
} {
  const evm = (id: number) => chainConfig(id).evm && chainConfig(id).chainId === id;
  const primary = [...new Set([input.home, ...PRIMARY_NETWORKS.filter((id) => evm(id) && input.configured.includes(id))])];
  const secondary = SECONDARY_NETWORKS.filter(
    (id) => evm(id) && !primary.includes(id) && input.configured.includes(id) && (input.held.includes(id) || id === input.asked),
  );
  const selected = input.asked != null && (primary.includes(input.asked) || secondary.includes(input.asked)) ? input.asked : input.home;
  return { primary, secondary, selected };
}

/** The secondary networks a founder could still open, for the "More networks" link. */
export function moreNetworks(input: { configured: readonly number[]; shown: readonly number[] }): number[] {
  return SECONDARY_NETWORKS.filter((id) => chainConfig(id).evm && chainConfig(id).chainId === id && input.configured.includes(id) && !input.shown.includes(id));
}
