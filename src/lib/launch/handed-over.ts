import { readPage, type ReaderDeps, type PageRead } from "@/lib/read/page-reader";
import { firstUrl } from "./hand-over-text";

/**
 * HAND IT TO SAGE: READ WHAT WAS HANDED OVER (28 Oct 2026; every kind of link, 5 Nov 2026).
 *
 * The founder, on the composer: "currently pay for work looks so packed", and of chat boxes: "simple
 * type to agent got too common that no one uses". The work people want done is usually written down
 * already: an issue, a doc, a sheet, a post, a page. So Post takes the link and Sage reads it itself, the
 * way a person handed the same link would, then drafts the job from it.
 *
 * Reading is the page reader's job (read/page-reader.ts). Each kind of link goes through its own public
 * door, and any other page through the guarded read. The page reaches the model fenced as UNTRUSTED
 * (gig-draft.ts). It describes the work; it never sets the money.
 */
export interface HandedOver {
  url: string;
  /** how the page is named back to the founder: "github.com/acme/app/issues/42" */
  label: string;
  read: boolean;
  /** what Sage read, capped; empty when it could not read it */
  text: string;
  /** why it could not, in plain words */
  reason: string | null;
  /** what kind of link it was (an issue, a sheet, a video…), for the founder's progress line */
  kind?: PageRead["kind"];
}

/** How much of a handed-over page reaches the drafter: a long brief or a big issue fits whole. */
export const MAX_SOURCE_CHARS = 12_000;

export type HandedOverDeps = ReaderDeps;

export async function readHandedOver(text: string, deps: HandedOverDeps = {}): Promise<HandedOver | null> {
  const url = firstUrl(text);
  if (!url) return null;
  const r = await readPage(url, { maxChars: MAX_SOURCE_CHARS, ...deps });
  return { url: r.url, label: r.label, read: r.read, text: r.text, reason: r.reason, kind: r.kind };
}
