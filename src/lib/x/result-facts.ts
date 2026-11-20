import "server-only";
import { listSubmissions } from "@/lib/db/campaigns";
import { storedFindings } from "@/lib/report";
import { OTHER_NOTES } from "@/lib/report/core";
import { isVerbatim, pickQuote, plainWords } from "./compose";

/**
 * WHAT A RESULT POST MAY SAY ABOUT A TEST: its top finding and one thing a person wrote.
 *
 * The finding comes from the builder's findings report (`topFindingFor`). With no report yet there is
 * no finding, and the quote is one whole sentence taken from a paid person's own answer. Either way the
 * quote is checked against stored evidence here, last, so a summary that paraphrased can never put words
 * in a tester's mouth: a quote that is not an exact substring of a paid answer is dropped.
 */
export type ResultFacts = {
  /** the top finding in a few plain words (no handle, no link), or null when there is no report */
  finding: string | null;
  /** one sentence exactly as a paid person wrote it, or null */
  quote: string | null;
};

/**
 * The findings report's top finding (`src/lib/report/`): the group the most people ran into, counted from
 * distinct answers (never a stored number), and "Other notes" only when there is nothing else. `null`
 * means there is no report for this test yet. Whatever comes back is re-checked by `resultFactsFor`.
 */
export function topFindingFor(campaignId: string): ResultFacts | null {
  const findings = storedFindings(campaignId)?.json?.findings ?? [];
  if (findings.length === 0) return null;
  const people = (f: (typeof findings)[number]) => new Set(f.submissionIds).size;
  const named = findings.filter((f) => f.title !== OTHER_NOTES);
  const top = [...(named.length > 0 ? named : findings)].sort((a, b) => people(b) - people(a))[0];
  if (!top) return null;
  return { finding: top.title, quote: top.quotes[0]?.text ?? null };
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
