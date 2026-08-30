/**
 * WHERE A STARKNET TRANSACTION IS SHOWN — one place.
 *
 * The URL was written inline in six files, so "which explorer" was a decision nobody could change
 * without finding all of them, and a link built from an empty hash produced `…/tx/` — a dead page
 * offered to someone who had just been paid.
 *
 * Starkscan is the choice: it is where Sage's own mainnet transactions are linked from, including
 * the hackathon leaderboard entries, so a receipt and the record it belongs to point at the same
 * explorer instead of two.
 */
const BASE = "https://starkscan.co";

/** The explorer page for a transaction, or null when there is no hash to link to. */
export function starknetTxUrl(txHash: string | null | undefined): string | null {
  const t = txHash?.trim();
  // An empty hash reaches here whenever the CHAIN answered a collection before the wallet did —
  // the collection is real, there is simply no hash on this side. Returning null makes the caller
  // say that, instead of linking to nowhere.
  if (!t || !/^0x[0-9a-fA-F]+$/.test(t)) return null;
  return `${BASE}/tx/${t}`;
}

/** The explorer page for a contract or account. */
export function starknetAddressUrl(address: string | null | undefined): string | null {
  const a = address?.trim();
  if (!a || !/^0x[0-9a-fA-F]+$/.test(a)) return null;
  return `${BASE}/contract/${a}`;
}

export const STARKNET_EXPLORER = BASE;
