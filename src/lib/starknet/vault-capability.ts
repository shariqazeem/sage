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
  /**
   * The privacy class — SageVault declared 2026-09-02, events keyed by `intent_hash`. Same
   * `request_payout_to` entrypoint (contracts-starknet/src/vault.cairo). It was MISSING here for two
   * days: the first campaign deployed from it paid ten workers as plain public transfers, because
   * `payoutRouteFor` read this list and answered "direct". Nobody was underpaid; the campaign whose
   * whole point was private payouts simply made none. Two lists drifted — the deployer's class and
   * this one — which is why the current deploy class is now capable by construction below.
   */
  "0x6d55773e63601dfbd861c78e03c5ac3085b472d7c067d9c5634da03a00b5aa0",
];

/** Classes known to PREDATE the split — never capable, whatever the env says. */
const PRE_SPLIT: readonly string[] = [
  "0x2770f9fde4668abd9bfffbf8aeca2ce5d104ed812054afa22cdc78356500e84",
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
export function classSupportsSplitPayout(
  classHash: string | null | undefined,
  currentDeployClass: string | null | undefined = process.env.STARKNET_VAULT_CLASS_HASH,
): boolean {
  const c = norm(classHash);
  if (!c) return false;
  if (SPLIT_CAPABLE.some((k) => norm(k) === c)) return true;
  // Every class Sage has deployed from since 2026-08-30 carries the split, so the class the deployer
  // is configured with today is capable unless it is a known pre-split class. This is the deployer's
  // own list, read from the same env it reads — the one that cannot drift behind it.
  return norm(currentDeployClass) === c && !PRE_SPLIT.some((k) => norm(k) === c);
}

/** The declared split-capable classes, for diagnostics. */
export const SPLIT_CAPABLE_CLASSES = SPLIT_CAPABLE;
