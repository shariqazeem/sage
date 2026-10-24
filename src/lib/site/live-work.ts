import "server-only";
import { getDecisionByPayoutTx, listCampaigns } from "@/lib/db/campaigns";
import { founderStorageKey } from "@/lib/auth/founder";
import { flaggingLinksOf } from "@/lib/campaigns/wallet-links";
import { liveProof, type LiveReceipt } from "./live-proof";

/**
 * THE AGENT AT WORK, FROM A REAL PAYOUT. The front door shows one payout the way Sage decided it:
 * the job, each criterion it checked, the words from the evidence that met it, and what it paid.
 * Read from the stored decision behind a real-money receipt, the same record the receipt page
 * publishes. Nothing is a sample: with no payout that carries its checks, the page shows the plain
 * receipt instead.
 *
 * Quotes are verbatim substrings of the public evidence (enforceQuotes drops anything else before a
 * decision is stored); a long one is shortened with an ellipsis, never reworded.
 */
export interface WorkedPayout extends LiveReceipt {
  checks: { text: string; quote: string | null }[];
  confidencePct: number | null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** A quote a reader can read: words, not a hash or an address (those are shown on the receipt itself). */
function readable(q: string | undefined): q is string {
  const t = (q ?? "").trim();
  return t.length >= 12 && /\s/.test(t) && /[a-z]{3,}/i.test(t) && !/^0x[0-9a-f]{8,}/i.test(t);
}

/** Pure: from a payout's decision, the checks worth showing, or null when it can't carry the story. */
export function checksFrom(brief: { criteria?: { criterion: string; met: boolean; quote?: string }[]; confidence?: number } | null | undefined): Pick<WorkedPayout, "checks" | "confidencePct"> | null {
  const met = (brief?.criteria ?? []).filter((c) => c.met && c.criterion.trim().length > 0);
  if (met.length < 2 || !met.some((c) => readable(c.quote))) return null;
  return {
    checks: met.slice(0, 3).map((c) => ({ text: clip(c.criterion.trim(), 120), quote: readable(c.quote) ? clip(c.quote.trim().replace(/\s+/g, " "), 140) : null })),
    confidencePct: typeof brief?.confidence === "number" ? Math.round(brief.confidence * 100) : null,
  };
}

/**
 * Whom the front door may show as "paid": not Sage's own wallets (the ledger already marks those), not
 * a wallet that funds jobs here, and not one the farm watch has linked to others.
 */
export function showablePayee(recipient: string | null, funders: ReadonlySet<string>): boolean {
  if (!recipient) return false;
  if (funders.has(founderStorageKey(recipient))) return false;
  return flaggingLinksOf(recipient).length === 0;
}

export function funderKeys(): Set<string> {
  return new Set(listCampaigns().map((c) => founderStorageKey(c.posterWallet)));
}

/** The latest real payouts the front door may show, newest first. */
export function showableReceipts(limit = 6, scan = 60): LiveReceipt[] {
  const funders = funderKeys();
  return liveProof(scan).receipts.filter((r) => showablePayee(r.recipient, funders)).slice(0, limit);
}

/**
 * The most recent real-money payout whose decision shows its checks, or null.
 *
 * Never a payout to a wallet that funds jobs here, or one the farm watch has linked to others. Measured 24 Oct 2026 on the production ledger: 9 of
 * 65 paid submissions went to wallets that also posted work (the founder's own runs of the product).
 * Real, and each has a receipt, but the front door's example of "pays people" must be a person who
 * was paid, not the payer paying themselves.
 */
export function workedPayout(scan = 40): WorkedPayout | null {
  const funders = funderKeys();
  for (const r of liveProof(scan).receipts) {
    // the gig farmed across twelve wallets in September paid every one of them, each with a receipt,
    // and none of them is the example; nor is a funder paying themselves
    if (!showablePayee(r.recipient, funders)) continue;
    const decision = getDecisionByPayoutTx(r.txHash);
    const shown = checksFrom(decision?.brief);
    if (shown) return { ...r, ...shown };
  }
  return null;
}
