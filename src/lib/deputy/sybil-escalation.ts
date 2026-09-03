import type { BriefFraudSignal } from "./brain-core";

/**
 * THE SHAPE OF A FARM, NAMED.
 *
 * Measured on the first Starknet gig (2026-09-03): ten of ten rewards went to one operator. Every
 * wallet was minutes old, funded with gas by the previous wallet in the chain, submitted a page from
 * a GitHub or dev.to account created minutes earlier, and forwarded its $1.10 to one collection
 * wallet. Each of those facts alone is a medium signal — a friend funding your gas is honest, a
 * newcomer's first wallet is honest, a new GitHub account is honest — and the autopilot gate holds
 * only on a HIGH signal, so ten mediums paid ten times.
 *
 * Together they are not honest. A wallet that is fresh AND was funded by another submitter of the
 * same campaign (or sits in a payout-consolidation cluster with one) is the rotation pattern, and a
 * fresh author account on top of it is the same person again. That combination becomes one HIGH
 * signal, so the gate holds it for the founder — a hold with the reason written out, never a
 * refusal. The individual mediums stay in the brief; nothing is hidden from the reviewer.
 */
export const SYBIL_SIGNAL = "sybil pattern";

const has = (signals: readonly BriefFraudSignal[], name: string) => signals.some((s) => s.signal === name && s.severity !== "low");

export function escalateSybil(signals: readonly BriefFraudSignal[]): BriefFraudSignal | null {
  const freshWallet = has(signals, "fresh wallet");
  const freshAuthor = has(signals, "fresh author account");
  const fundedByPeer = has(signals, "funded by another submitter") || has(signals, "sibling-funded wallets");
  const clustered = has(signals, "wallet cluster");
  const linked = fundedByPeer || clustered;
  if (!linked) return null;
  if (!freshWallet && !freshAuthor) return null;
  const parts = [
    freshWallet ? "a wallet with no history" : null,
    freshAuthor ? "an author account created for this campaign" : null,
    clustered ? "a wallet linked to other submitters by where their payouts went" : "gas funded by another submitter of this campaign",
  ].filter(Boolean);
  return {
    signal: SYBIL_SIGNAL,
    severity: "high",
    reason: `${parts.join(", ")} — the wallet-rotation shape of one person taking several rewards. Held for the founder to look at; the individual signals are listed alongside.`,
  };
}
