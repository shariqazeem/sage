/**
 * STATED TERMS — what the founder's own words commit them to, read deterministically.
 *
 * The money invariant of this product is that no model ever computes an amount. That is enforced
 * downstream: the budget compiler derives every reward, and the vault derives the payout. But
 * there is an earlier step nothing checked — the model still TRANSCRIBES the founder's numbers
 * into the plan, and a transcription can silently drop one.
 *
 * MEASURED by P-DIRECT: "fund my cousin's shop $60 in three milestones: $20 when the shop page is
 * published, $20 when the first product is listed, $20 when the first sale is announced" was
 * sometimes compiled as ONE milestone worth $20. Every gate downstream passed it, because
 * $20 × 1 === $20 is a perfectly consistent budget — it is simply not the founder's budget. The
 * failure only becomes visible when the second recipient is told their work has no milestone,
 * after they have done it.
 *
 * So this reads the founder's arithmetic instead of the model's. It infers ONLY from what they
 * made explicit, and stays silent otherwise — a check that guesses is worse than no check, because
 * it would block honest plans over phrasing.
 */

/** A number carrying a currency marker: "$60", "60 USD", "J$5,000", "60 dollars", "€1.500,00" no. */
const AMOUNT_RE =
  /(?:([$€£₹¥])\s?(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s?(?:usd|usdc|dollars?|euros?|pounds?|rupees?|naira|pesos?|jmd|kyd|ttd|bbd|xcd)\b)/gi;

/** "three milestones", "2 tranches", "in 4 stages" — a count the founder said out loud. */
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const COUNT_RE = new RegExp(
  String.raw`\b(\d{1,2}|${Object.keys(WORD_NUMBERS).join("|")})\s+` +
    String.raw`(?:equal\s+|separate\s+|monthly\s+|weekly\s+)?` +
    String.raw`(milestones?|tranches?|stages?|instal?lments?|payments?|phases?|deliverables?)\b`,
  "i",
);

export type StatedTerms = {
  /** The total the founder's OWN numbers prove, or null when they did not spell one out. */
  totalAmount: number | null;
  /** How many tranches they named in words, or null. */
  milestoneCount: number | null;
};

/** Every currency-marked amount in the text, in order, with multiplicity. */
export function statedAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const raw = m[2] ?? m[3];
    if (!raw) continue;
    const n = Number(raw.replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

/**
 * An amount the founder LABELLED as the total — "$40 total", "total of $40", "$40 in total".
 *
 * This is more direct evidence than the sum identity below, and it is the only signal available
 * when the tranches are described in words rather than numbers ("half ... and half. $40 total.").
 * "budget" is deliberately NOT a total marker: "I have a $500 budget, pay $50 for this" is an
 * honest plan that spends part of a budget, and reading that as a total would block it.
 *
 * "up to $40" is a ceiling, not a total — a plan under it is correct, so it is excluded.
 */
const CEILING_BEFORE = /(?:up\s+to|as\s+much\s+as|at\s+most|max(?:imum)?(?:\s+of)?|no\s+more\s+than)\s*$/i;

function labelledTotal(text: string): number | null {
  // "$40 total" / "40 USD in total"
  const after = /(?:([$€£₹¥])\s?(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s?(?:usd|usdc|dollars?))\s*(?:in\s+)?total\b/i;
  // "total of $40" / "total: $40"
  const before = /\btotal\s*(?:of|is|=|:)?\s*(?:([$€£₹¥])\s?(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s?(?:usd|usdc|dollars?))/i;
  for (const re of [after, before]) {
    const m = re.exec(text);
    if (!m) continue;
    if (CEILING_BEFORE.test(text.slice(0, m.index))) continue;
    const n = Number((m[2] ?? m[3] ?? "").replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export function readStatedTerms(text: string): StatedTerms {
  const amounts = statedAmounts(text);

  // THE SUM IDENTITY. When one stated amount equals the sum of all the others, the founder has
  // shown their own arithmetic — "$60 ... $20, $20, $20" — and the larger one is the total. This
  // is deliberately the ONLY inference: "I have a $500 budget, pay $50 for this" states two
  // amounts that satisfy no such identity, so nothing is inferred and nothing is blocked.
  let totalAmount: number | null = labelledTotal(text);
  if (totalAmount === null && amounts.length >= 3) {
    const sum = amounts.reduce((a, b) => a + b, 0);
    for (const candidate of amounts) {
      // candidate === the sum of all the others. No further test is needed: with three or more
      // POSITIVE amounts, only the unique largest can satisfy this, so a tranche can never
      // masquerade as the total. (Checked by probe over 200k random cases — a `candidate is max`
      // clause here was unreachable, and an unreachable clause in a money guard reads as
      // protection that is not there.)
      if (Math.abs(sum - candidate * 2) < 0.005) {
        totalAmount = candidate;
        break;
      }
    }
  }

  const countMatch = COUNT_RE.exec(text);
  let milestoneCount: number | null = null;
  if (countMatch) {
    // A count the founder said outright wins — the branches are ordered so that precedence is
    // structural, not a condition that could be dropped without changing behaviour.
    const token = countMatch[1].toLowerCase();
    const n = WORD_NUMBERS[token] ?? Number(token);
    if (Number.isFinite(n) && n >= 1 && n <= 20) milestoneCount = n;
  } else if ((text.match(/\bhalf\b/gi) ?? []).length >= 2) {
    // "half when she publishes the catalogue and half when she posts a review" — two tranches,
    // named as fractions instead of a count. Requires the word TWICE, so "half up front" alone
    // (where the remainder is never described) infers nothing.
    milestoneCount = 2;
  }

  return { totalAmount, milestoneCount };
}

export type PlannedMilestone = { rewardUsd: number; rewardLocal?: number; slots: number };
export type TermsMismatch =
  | { field: "total" | "count"; stated: number; planned: number }
  /** The founder never named a price anywhere and the plan carries one. `stated` is 0 by definition. */
  | { field: "invented"; stated: 0; planned: number };

/**
 * Compare the founder's stated terms against the plan the model built. Returns the contradictions,
 * empty when they agree or when the founder stated nothing to check.
 *
 * Currency: the founder's numbers are in THEIR currency, so a non-USD plan is compared against
 * `rewardLocal` — the amount they actually said. When only some milestones carry a local amount
 * the comparison is ambiguous, so it is skipped rather than guessed.
 */
export function checkStatedTerms(
  text: string,
  milestones: PlannedMilestone[],
  opts: {
    /**
     * EVERY word the founder has said in this conversation, for the invented-amount check only.
     *
     * That check asks "did they ever name a price", and the honest scope for it is the whole
     * conversation: a founder who said "$50" two turns ago and now says "yes, go ahead" has stated
     * a price, and reading only this turn would accuse the model of inventing their own number.
     * The total and count checks deliberately keep reading THIS turn — they compare arithmetic
     * inside one request, and summing amounts across unrelated turns would invent a total nobody
     * stated. Omitted → the invented check reads `text`, which is the conservative direction only
     * when this turn is all there is.
     */
    allFounderText?: string;
  } = {},
): TermsMismatch[] {
  const stated = readStatedTerms(text);
  const out: TermsMismatch[] = [];
  if (milestones.length === 0) return out;

  /*
    NOBODY NAMED A PRICE, AND THE PLAN HAS ONE.

    Measured by P-DIRECT (pd-vague-no-amount): "I want to pay someone to design a logo for me"
    compiled into a funded-looking campaign at a number the model chose. Every downstream gate
    passed it — an invented $25 is as internally consistent as a stated one — and the founder would
    have discovered the price they never set at the funding screen.

    This is the money invariant at its earliest point: the model may transcribe an amount, never
    author one. It fires only when the founder's words contain NO currency-marked number at all
    across the whole conversation, so an ambiguous phrasing is never enough to trip it.
  */
  const founderWords = opts.allFounderText ?? text;
  if (statedAmounts(founderWords).length === 0) {
    const planned = milestones.reduce((sum, m) => sum + (m.rewardLocal ?? m.rewardUsd) * m.slots, 0);
    if (planned > 0) out.push({ field: "invented", stated: 0, planned });
  }

  if (stated.milestoneCount !== null && stated.milestoneCount !== milestones.length) {
    out.push({ field: "count", stated: stated.milestoneCount, planned: milestones.length });
  }

  if (stated.totalAmount !== null) {
    const allLocal = milestones.every((m) => typeof m.rewardLocal === "number");
    const anyLocal = milestones.some((m) => typeof m.rewardLocal === "number");
    if (!anyLocal || allLocal) {
      const planned = milestones.reduce(
        (sum, m) => sum + (allLocal ? (m.rewardLocal as number) : m.rewardUsd) * m.slots,
        0,
      );
      if (Math.abs(planned - stated.totalAmount) >= 0.005) {
        out.push({ field: "total", stated: stated.totalAmount, planned });
      }
    }
  }

  return out;
}

/** The correction handed back to the model — states the founder's numbers, never new ones. */
export function statedTermsCorrection(mismatches: TermsMismatch[]): string {
  // An invented price is not a mismatch to rebuild from — there is nothing to rebuild from. It is
  // the one case where the only correct next move is a question, so it answers on its own.
  if (mismatches.some((m) => m.field === "invented")) {
    return (
      `The founder has not said what this pays, and you priced it yourself — no amount in this plan came from them. ` +
      `Do not create the campaign. Ask them what it should pay (and, if the work has stages, how much each stage pays), ` +
      `then build it from their answer. Never choose a number on their behalf.`
    );
  }
  const parts = mismatches.map((m) =>
    m.field === "count"
      ? `they asked for ${m.stated} milestones and this plan has ${m.planned}`
      : `their own numbers add up to ${m.stated} and this plan totals ${m.planned}`,
  );
  return (
    `This plan does not match what the founder said: ${parts.join("; ")}. ` +
    `Rebuild it from their exact words — every amount and every milestone they named, nothing added. ` +
    `Do not invent a number to make the arithmetic work: if their words are genuinely ambiguous, ask them.`
  );
}
