import "server-only";
import { listSubmissions } from "@/lib/db/campaigns";
import { isVerbatim, pickQuote, plainWords } from "./compose";

/**
 * WHAT A RESULT POST MAY SAY ABOUT A TEST: its top finding and one thing a person wrote.
 *
 * ┌─ SEAM FOR THE FINDINGS WORKSTREAM (WS4) ───────────────────────────────────────────────────────┐
 * │ `topFindingFor` is where the findings report plugs in. When the report exists, return its      │
 * │ first grouped finding here (a few plain words, and a quote the report already holds). Nothing  │
 * │ else in `src/lib/x/` needs to change: `resultFactsFor` below re-checks whatever comes back.    │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Until then there is no finding, and the quote is one whole sentence taken from a paid person's own
 * answer. Either way the quote is checked against stored evidence here, last, so a summary that
 * paraphrased can never put words in a tester's mouth: a quote that is not an exact substring of a
 * paid answer is dropped.
 */
export type ResultFacts = {
  /** the top finding in a few plain words (no handle, no link), or null when there is no report */
  finding: string | null;
  /** one sentence exactly as a paid person wrote it, or null */
  quote: string | null;
};

/** WS4 replaces this body. `null` means "no findings report for this test". */
export function topFindingFor(campaignId: string): ResultFacts | null {
  void campaignId;
  return null;
}

/** The answers of people who were paid for this test, newest first: the only evidence a quote may come from. */
export function paidNotes(campaignId: string): string[] {
  return listSubmissions(campaignId)
    .filter((s) => s.status === "paid" && typeof s.note === "string" && s.note.trim().length > 0)
    .map((s) => s.note as string);
}

export function resultFactsFor(campaignId: string, source: (id: string) => ResultFacts | null = topFindingFor): ResultFacts {
  const notes = paidNotes(campaignId);
  const reported = source(campaignId);
  const finding = plainWords(reported?.finding, 90);
  const offered = reported?.quote ?? null;
  // a reported quote must pass the same test as one picked here: whole, plain, and really in the evidence
  const quote = offered && isVerbatim(offered, notes) && pickQuote([offered]) === offered ? offered : pickQuote(notes);
  return { finding, quote: quote && isVerbatim(quote, notes) ? quote : null };
}
