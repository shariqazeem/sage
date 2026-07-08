import { submissionIntentHash } from "@/lib/db/keys";
import { short } from "@/lib/format";

/**
 * Pure labelling for settled payouts. The on-chain `SpendSettled` event carries
 * the intent hash; `buildIntentHashMap` recomputes each submission's deterministic
 * hash (Pass 8 `keys.ts`) so a settlement can be matched back to its campaign +
 * recipient. No new data — a join of two real sources.
 */

export interface IntentRef {
  campaignTitle: string;
  wallet: string;
}

/** "<campaign title> — payout to 0x1234…5678". */
export function settlementLabel(campaignTitle: string, wallet: string): string {
  return `${campaignTitle} — payout to ${short(wallet)}`;
}

/** Map each submission's on-chain intent hash → its campaign + recipient. */
export function buildIntentHashMap(
  entries: {
    campaignId: string;
    campaignTitle: string;
    submissionId: string;
    wallet: string;
  }[],
): Record<string, IntentRef> {
  const out: Record<string, IntentRef> = {};
  for (const e of entries) {
    const key = submissionIntentHash(e.campaignId, e.submissionId).toLowerCase();
    out[key] = { campaignTitle: e.campaignTitle, wallet: e.wallet };
  }
  return out;
}
