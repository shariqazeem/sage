/**
 * WHICH VAULTS CAN SPLIT A PAYOUT'S EARNER FROM ITS DESTINATION.
 *
 * `request_payout_to` exists only in the class declared on 2026-08-30. Every vault deployed before
 * that — including the live starkscan campaign — is the earlier class and has no such entrypoint.
 * Calling it there is not a soft failure: the transaction reverts as an unknown selector, and on
 * the settlement path that is a worker whose cleared submission cannot be paid.
 *
 * So capability is decided by the class the vault was actually deployed from, read off chain, and
 * an unrecognised class is treated as NOT capable. The direction of that default matters: assuming
 * capable and being wrong strands a payout, assuming not-capable and being wrong pays the worker
 * publicly — a worse privacy outcome, not a worse money outcome, and a recoverable one.
 */

/** Class hashes known to expose `request_payout_to`, normalised (lower case, no leading zeros). */
const SPLIT_CAPABLE: readonly string[] = [
  /**
   * SageVault with `request_payout_to`. Declared on mainnet 2026-08-30 in
   * tx 0x17bd5c3cee03ffce89f8a4233af4632d72d78d1e8a0b9c8d007dd6ccb5858f0, and READ BACK off chain
   * before being trusted here: 4390 Sierra felts, 19 entrypoints,
   * `request_payout_to(mission_id, worker, payout_target, decision_digest, intent_hash)`.
   *
   * The predecessor 0x2770f9fd… is deliberately absent. Every vault deployed from it — including
   * the live starkscan campaign — has no such entrypoint, and asking it would revert as an unknown
   * selector.
   */
  "0x715ab98f0d29548209259a6283d1b1db317b07b4f16441b068c02eaa40ffa87",
];

const norm = (v: string | null | undefined): string | null => {
  const t = v?.trim().toLowerCase();
  if (!t || !/^0x[0-9a-f]+$/.test(t)) return null;
  const stripped = t.slice(2).replace(/^0+/, "");
  return stripped ? `0x${stripped}` : null;
};

/**
 * Can this class pay a worker into somewhere other than their own address?
 *
 * Unknown, malformed, or absent → false. A vault is only ever treated as capable because its class
 * is on the list, never because a call happened to succeed.
 */
export function classSupportsSplitPayout(classHash: string | null | undefined): boolean {
  const c = norm(classHash);
  if (!c) return false;
  return SPLIT_CAPABLE.some((k) => norm(k) === c);
}

/** The declared split-capable classes, for diagnostics. */
export const SPLIT_CAPABLE_CLASSES = SPLIT_CAPABLE;
