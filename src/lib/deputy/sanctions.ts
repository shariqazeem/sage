import { OFAC_SDN_ETH, OFAC_SDN_SNAPSHOT_DATE } from "./sanctions-data";

/**
 * SANCTIONS SCREENING (FC plan #2) — a deterministic compliance control on the money path.
 *
 * Every payout recipient is screened against a VENDORED snapshot of the U.S. Treasury OFAC SDN
 * digital-currency address list (ETH entries). Deliberately not a runtime API call: the money path
 * takes no third-party dependency, the check is reproducible byte-for-byte, and refreshing the
 * list is a reviewed diff (`node scripts/update-sanctions.mjs`), never a silent remote change.
 *
 * Three doors, one predicate: the submit route refuses a sanctioned wallet up front, the
 * autonomous pipeline HOLDS it preflight (before any judge spend), and manual release refuses it —
 * so a listed address cannot be paid by the AI or by a human clicking release. Exact-address
 * matching only (case-insensitive); no fuzzy heuristics on a list this consequential.
 */

const SDN = new Set<string>(OFAC_SDN_ETH); // already lowercased by the generator

export const SANCTIONS_LIST_LABEL = `OFAC SDN digital-currency list (ETH), snapshot ${OFAC_SDN_SNAPSHOT_DATE}`;
export const SANCTIONS_HOLD_REASON = `sanctions_screen:ofac_sdn:${OFAC_SDN_SNAPSHOT_DATE}`;
export const SANCTIONS_LIST_SIZE = SDN.size;
export { OFAC_SDN_SNAPSHOT_DATE };

/** True when the wallet appears on the vendored SDN snapshot. Malformed input is never a match. */
export function isSanctionedWallet(wallet: string | null | undefined): boolean {
  if (typeof wallet !== "string") return false;
  const w = wallet.trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(w) && SDN.has(w);
}
