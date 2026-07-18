import "server-only";

import { getAddress, type Address } from "viem";
import { publicClient } from "./chain";
import { chainLabel } from "./networks";
import type { BriefFraudSignal } from "./brain-core";

/**
 * Wallet heuristics (P18) — a recipient-freshness CAUTION signal, recorded on the decision brief as a
 * SIGNAL ONLY. It is DELIBERATELY never "high" severity, so it can NEVER block a payout on its own: the
 * autopilot gate holds only on a HIGH-severity fraud signal, so a fresh wallet adds weight that
 * "combines with other signals" (a fresh wallet next to weak evidence is what a reviewer weighs) but a
 * fresh wallet next to strong, verified evidence still pays. This never touches the frozen judgment
 * layer — it appends to the same fraudSignals channel the brain already produces, after hardening.
 *
 * Fully failure-isolated: an RPC error yields NO signal (an infra blip must never become an accusation).
 */

/** nonce (prior tx count on the campaign chain) at/below which a wallet reads as "fresh". */
const BRAND_NEW = 0; // no prior transactions at all — a new or single-use account
const YOUNG = 3; // still a young account; above this we stay silent

export async function walletFreshnessSignal(
  wallet: string,
  chainId?: number,
): Promise<BriefFraudSignal | null> {
  let nonce: number;
  try {
    nonce = await publicClient(chainId).getTransactionCount({
      address: getAddress(wallet) as Address,
    });
  } catch {
    return null; // can't read → no signal (never a false accusation from an RPC blip)
  }
  if (nonce > YOUNG) return null; // established enough — no caution
  const chain = chainLabel(chainId);
  if (nonce <= BRAND_NEW) {
    return {
      signal: "fresh wallet",
      severity: "med",
      reason: `recipient wallet has no prior transactions on ${chain} — a brand-new or single-use account`,
    };
  }
  return {
    signal: "fresh wallet",
    severity: "low",
    reason: `recipient wallet has only ${nonce} prior transaction(s) on ${chain} — a young account`,
  };
}
