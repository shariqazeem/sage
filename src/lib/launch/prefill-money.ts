import { statedAmounts } from "./stated-terms";
import { statedCurrency, statedHeadcount } from "./direct-fallback";

/**
 * THE FOUNDER'S WORDS ARE THE MONEY — on the web door too. The draft never invents an amount, but a
 * sentence like "Give a market seller J$1,600 in two equal parts" or "Pay J$800 to each of 8 people"
 * states the currency, the number and the shape. The direct door reads them; the form should not
 * make the founder retype what they just wrote. Deterministic, no model, and every field stays
 * editable — this only fills what the sentence says, and says nothing when it is ambiguous.
 */
const EQUAL_RE = /\b(?:equal|equally|iguales|égales|egales|even|evenly)\b/i;
const HALVES_RE = /\b(?:half|mitad|moiti[eé])\b/gi;
const PER_UNIT_RE = /\b(?:each|per person|per head|apiece|every one|a person|cada uno|chacun)\b/i;

export interface MoneyPrefill {
  currency: string | null;
  /** one stated total to split exactly across milestones (grants) */
  splitTotal: number | null;
  /** one stated price per completion (gigs / bounties) */
  perUnit: number | null;
  headcount: number | null;
}

export function prefillMoneyFromWords(text: string, milestoneCount: number): MoneyPrefill {
  const currency = statedCurrency(text);
  const amounts = statedAmounts(text);
  const headcount = statedHeadcount(text);
  const equal = EQUAL_RE.test(text) || (text.match(HALVES_RE) ?? []).length >= 2;
  if (amounts.length !== 1) return { currency, splitTotal: null, perUnit: null, headcount };
  const amount = amounts[0]!;
  if (milestoneCount > 1) {
    // one number + an equal-split cue = the grant's total; one number alone across many milestones is ambiguous
    return { currency, splitTotal: equal ? amount : null, perUnit: null, headcount };
  }
  // one milestone: a per-person price ("to each of 8 people") or the single price of one deliverable
  return { currency, splitTotal: null, perUnit: PER_UNIT_RE.test(text) || headcount === null || headcount === 1 ? amount : null, headcount };
}
