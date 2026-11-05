import type { BriefFraudSignal } from "./brain-core";

/**
 * ONE PERSON'S WALLETS ARE NOT SEVERAL PEOPLE: THE LINKED-CLUSTER SIGNAL, ON EVERY RAIL.
 *
 * When the payout watch (consolidation.ts) sees a payout forwarded to another submitter, or to a wallet
 * collecting from several paid wallets, it links the pair in `wallet_links`. A submission from a wallet
 * linked to another submitter of the same job then carries a HIGH "wallet cluster" signal, which the gate
 * holds for the founder. That signal existed only on Starknet, where the farm was caught, so on Metis a
 * proven cluster still paid as separate people (found 5 Nov 2026).
 *
 * Pure: the links come from the caller (`linkedWalletsOf` in production), and `norm` is the rail's
 * canonical spelling of an address.
 */
export function linkedClusterSignal(
  wallet: string,
  peerWallets: readonly string[],
  linkedOf: (wallet: string) => string[],
  norm: (wallet: string) => string,
): BriefFraudSignal | null {
  const me = norm(wallet);
  const peers = new Set(peerWallets.map(norm).filter((w) => w !== me));
  if (peers.size === 0) return null;
  const linkedPeers = [...new Set(linkedOf(wallet).map(norm))].filter((w) => w !== me && peers.has(w));
  if (linkedPeers.length === 0) return null;
  const shortOf = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  return {
    signal: "wallet cluster",
    severity: "high",
    reason: `this wallet is linked on-chain to ${linkedPeers.length} other submitter${linkedPeers.length === 1 ? "" : "s"} of this campaign (${linkedPeers.slice(0, 3).map(shortOf).join(", ")}) — a payout from one of them was forwarded to the other, which is one person's wallets, not several people's`,
  };
}
