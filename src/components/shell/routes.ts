/**
 * WHERE THE APP SHELL LIVES — the single definition, imported by both the rail and the shell.
 *
 * THE RULE: if the rail links to it, the rail survives it. A nav item that makes its own chrome
 * disappear is worse than no nav item — you arrive somewhere with no way back but the logo.
 *
 * The rule used to live as a comment beside a regex in one file while the nav lived in another,
 * so it held for /marketplace and quietly failed for /explorer. One module, compared by a test.
 *
 * The capital surfaces you USE — the ledger, the credit file, the lender view — are shelled: a
 * page about moving money should read as part of a system rather than a loose document.
 *
 * TWO DELIBERATE EXCEPTIONS, both for the same reason — the visitor is not a founder:
 *
 * /docs carries its own sidebar, and offering a stranger a Dashboard link promises an account they
 * do not have.
 *
 * /proof/[tx] is the most-shared thing Sage produces. It is a RECEIPT — usually opened by someone
 * who has never heard of Sage, sent to prove one payment happened. Wrapping it in founder chrome
 * that offers "Launch a campaign" makes an artifact into an advert, and the page already carries
 * the standalone mark-and-kicker treatment for exactly that reason.
 */
export function isAppRoute(p: string): boolean {
  return (
    /^\/dashboard/.test(p) ||
    /^\/campaign\//.test(p) ||
    /^\/launch/.test(p) ||
    /^\/agent(\/|$)/.test(p) ||
    /^\/marketplace/.test(p) ||
    /^\/explorer/.test(p) ||
    /^\/record\//.test(p) ||
    /^\/lender/.test(p)
  );
}

/** The one route the rail offers that deliberately has no shell. */
export const SHELL_EXEMPT: readonly string[] = ["/docs"];
