import "server-only";

import { inspectProduct } from "@/lib/launch/inspect";

/**
 * THE FIRST LOOK — proof, in the same call, that Sage opened the URL the caller just gave it.
 *
 * `sage_start_inspection` returned an inspection id and a specimen plan for a different product.
 * Read literally that is a service which took your input and answered about something else, and the
 * OKX marketplace reviewer rejected it twice with exactly that complaint: "the results returned by
 * your service in actual calls don't match the capabilities stated in your service description."
 *
 * The honest fix is not more prose. It is to actually look. One page, on their URL, right now — the
 * address Sage landed on after redirects, the HTTP status, the page's own title and headings, what
 * is clickable, whether there is a form and whether it is an auth wall. None of that can be produced
 * without having fetched their product, and all of it is cheap.
 *
 * It is a FIRST LOOK, not the plan. The plan needs real browsing and minutes; this is the evidence
 * that the minutes have started on the right product.
 *
 * SAFETY IS ENTIRELY INHERITED. `inspectProduct` is the same guarded fetcher the inspection pipeline
 * uses: https-only, credentials-in-URL refused, blocked-host and private-IP checks, a DNS resolution
 * re-check on every redirect hop, a content-type allowlist and hard byte caps. Capped here to ONE
 * page at depth 0, so it is a single request, and it never throws — a failure is a value.
 */

/** Wall-clock budget for the peek. Deliberately small: this rides inside a call the caller expects
 *  to return in seconds, so a slow product must cost the response almost nothing. */
export const FIRST_LOOK_BUDGET_MS = 2500;

export interface FirstLook {
  /** true when Sage actually loaded a page at that URL in this call. */
  reached: boolean;
  /** The address Sage LANDED on — after redirects, so it differs from the requested URL when the
   *  product bounced us (www, locale, a marketing path). That difference is itself evidence. */
  landedUrl: string | null;
  httpStatus: number | null;
  title: string | null;
  headings: string[];
  /** What a first-time visitor can click here. */
  primaryActions: string[];
  /** Whether this first screen asks for credentials — the thing that decides if testers can even start. */
  hasForm: boolean;
  isAuthWall: boolean;
  /** Verbatim sentences from the page, so the caller can see Sage read the real content. */
  quotes: string[];
  /** Plain-language statement of what this is and what it is not. */
  note: string;
  /** Present only when Sage could not load the page — says why, in the caller's terms. */
  couldNotReach?: string;
}

const CAP = <T>(xs: readonly T[], n: number): T[] => xs.slice(0, n);

/**
 * Look at one page of the caller's product. Never throws, never blocks longer than the budget: on
 * any failure it returns `reached: false` with an honest reason, because a first look that cannot be
 * taken must not turn a successful inspection start into an error.
 */
export async function takeFirstLook(productUrl: string): Promise<FirstLook> {
  const miss = (why: string): FirstLook => ({
    reached: false,
    landedUrl: null,
    httpStatus: null,
    title: null,
    headings: [],
    primaryActions: [],
    hasForm: false,
    isAuthWall: false,
    quotes: [],
    couldNotReach: why,
    note: "Sage could not load this page in the moment you called. The full inspection is still running and uses a real browser, which reaches many products a plain fetch cannot — poll sage_get_inspection.",
  });

  try {
    const r = await inspectProduct(productUrl, {
      maxPages: 1,
      maxDepth: 0,
      timeBudgetMs: FIRST_LOOK_BUDGET_MS,
    });
    const page = r.observations[0];
    if (!page) return miss(r.limitations[0] ?? r.blocked[0]?.reason ?? "the page did not load in time");

    const form = page.forms[0] ?? null;
    return {
      reached: true,
      landedUrl: page.url,
      httpStatus: page.status,
      title: page.title || null,
      headings: CAP(page.headings, 5),
      primaryActions: CAP(page.ctas, 6),
      hasForm: page.forms.length > 0,
      isAuthWall: Boolean(form?.isAuth) || page.authBoundary === true,
      quotes: CAP(page.snippets, 2),
      note: "Sage fetched this page just now, in this call — the title, headings and actions above are that page's own. It is a FIRST LOOK, not the plan: the full inspection browses the product in a real browser and takes minutes. Poll sage_get_inspection for the missions.",
    };
  } catch {
    // inspectProduct is documented never to throw; this is belt-and-braces so a peek can never
    // convert a started inspection into a failed call.
    return miss("the page could not be read");
  }
}
