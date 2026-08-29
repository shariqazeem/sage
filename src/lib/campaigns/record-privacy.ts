import type { CreditSignals } from "./credit";
import type { RecordEntry, WalletRecord } from "./record";

/**
 * INCOME PRIVACY — proving someone earned it without publishing how much.
 *
 * Sage's Verified Work Record used to publish every payout in full: an amount per entry, a total
 * at the top, keyed to a wallet address, readable by anyone who had it. For a person whose testing
 * or gig income is a real part of what they live on, that is their income statement, posted
 * publicly, permanently. It was never a deliberate choice — it is simply what a record composed
 * from receipts looks like if nobody stops it — and it is the single most personal thing this
 * product was leaking.
 *
 * THE POINT IS THAT THE RECORD STILL WORKS. Redacting amounts does not gut it, because the
 * lending-relevant signal was never mostly the amount:
 *
 *   · how many separate jobs were verified and paid,
 *   · how many DIFFERENT counterparties chose to pay,
 *   · over how many months, and how recently,
 *   · what share of submitted work passed verification,
 *   · and a transaction hash for every one, so a stranger can confirm each payment HAPPENED.
 *
 * A lender learns "this person completed 23 verified jobs for 9 different payers over 7 months,
 * with an 84% pass rate, and here are the receipts." That is a credit profile. What it is not is a
 * published income.
 *
 * AMOUNTS ARE NOT DELETED, THEY ARE WITHHELD. The full figures stay in Sage's own ledger and are
 * disclosed by an attestation the worker asks for — scoped to what it says, and revocable, unlike
 * a viewing key, which is all-or-nothing and forever.
 *
 * This is a REDACTION, not an encryption: the amounts are absent from the response, not hidden
 * inside it. Anything published from the record must go through here, because the safe default has
 * to be the one you get by forgetting.
 */

/** An entry with its money withheld. Everything that anchors it stays. */
export interface PublicRecordEntry {
  at: number;
  campaignId: string;
  campaignTitle: string;
  kind: RecordEntry["kind"];
  missionTitle: string | null;
  /** The payment is still provable — only its size is withheld. */
  txHash: string;
  proofPath: string;
  chainId: number;
}

export interface PublicWalletRecord {
  wallet: string;
  completions: number;
  distinctCampaigns: number;
  firstAt: number | null;
  lastAt: number | null;
  entries: PublicRecordEntry[];
  /** Always true on a published record — states the omission rather than leaving it to be noticed. */
  amountsWithheld: true;
}

/** The signals a lender can read without learning what anyone was paid. */
export interface PublicCreditSignals {
  formulaVersion: string;
  completions: number;
  distinctCampaigns: number;
  distinctPayers: number;
  monthsActive: number;
  verificationPassRate: number | null;
  decidedSubmissions: number;
  daysSinceLastVerified: number | null;
  tenureDays: number | null;
  /** how the work splits across kinds, as COUNTS rather than sums. */
  byKindCount: { testing: number; gig: number; grant: number };
  amountsWithheld: true;
}

/**
 * The published form of a record.
 *
 * Written as an explicit field-by-field construction rather than a delete or a spread-and-omit.
 * A spread would carry every future field of `WalletRecord` into the public response
 * automatically, so the day someone adds `medianPayoutUsd` it would publish itself. This way a new
 * money field is invisible until someone deliberately adds it here.
 */
export function publicRecord(record: WalletRecord): PublicWalletRecord {
  return {
    wallet: record.wallet,
    completions: record.completions,
    distinctCampaigns: record.distinctCampaigns,
    firstAt: record.firstAt,
    lastAt: record.lastAt,
    entries: record.entries.map((e) => ({
      at: e.at,
      campaignId: e.campaignId,
      campaignTitle: e.campaignTitle,
      kind: e.kind,
      missionTitle: e.missionTitle,
      txHash: e.txHash,
      proofPath: e.proofPath,
      chainId: e.chainId,
    })),
    amountsWithheld: true,
  };
}

/**
 * The published form of the credit signals.
 *
 * `byKindUsd` becomes `byKindCount`: the SHAPE of someone's work is useful to a lender and costs
 * them nothing, while the sums are the income itself. Counts are recomputed from the entries
 * rather than derived from the sums, so no amount is touched on the way out.
 */
export function publicSignals(
  signals: CreditSignals,
  record: WalletRecord,
): PublicCreditSignals {
  const byKindCount = { testing: 0, gig: 0, grant: 0 };
  for (const e of record.entries) byKindCount[e.kind] += 1;

  return {
    formulaVersion: signals.formulaVersion,
    completions: signals.completions,
    distinctCampaigns: signals.distinctCampaigns,
    distinctPayers: signals.distinctPayers,
    monthsActive: signals.monthsActive,
    verificationPassRate: signals.verificationPassRate,
    decidedSubmissions: signals.decidedSubmissions,
    daysSinceLastVerified: signals.daysSinceLastVerified,
    tenureDays: signals.tenureDays,
    byKindCount,
    amountsWithheld: true,
  };
}

/**
 * Does this object still carry money anywhere?
 *
 * A belt-and-braces check for the tests and for any caller assembling a response by hand. It walks
 * the whole structure looking for the naming conventions this codebase uses for money, because the
 * realistic failure is not someone deciding to publish an amount — it is someone adding a field
 * and never thinking about this file at all.
 */
export function findMoneyFields(value: unknown, path = ""): string[] {
  const hits: string[] = [];
  const MONEY = /(usd|amount|total|inflow|reward|price|fee|balance)/i;
  const walk = (v: unknown, p: string): void => {
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${p}[${i}]`));
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) {
        const next = p ? `${p}.${k}` : k;
        // Two things a money-shaped NAME does not make money: a count, and prose. An amount is a
        // number (or a base-unit string of digits); a sentence explaining where amounts went is
        // not, and flagging it would make this guard noisy enough to be ignored — which is how a
        // real leak gets waved through.
        const isNumeric =
          typeof val === "number" ||
          typeof val === "bigint" ||
          (typeof val === "string" && /^-?\d+(\.\d+)?$/.test(val));
        if (MONEY.test(k) && !/count|withheld/i.test(k) && isNumeric) hits.push(next);
        walk(val, next);
      }
    }
  };
  walk(value, path);
  return hits;
}
