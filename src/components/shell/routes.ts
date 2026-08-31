/**
 * WHERE THE APP SHELL LIVES — the single definition, imported by both the rail and the shell.
 *
 * THE RULE: if the rail links to it, the rail survives it. A nav item that makes its own chrome
 * disappear is worse than no nav item — you arrive somewhere with no way back but the logo.
 *
 * The rule used to live as a comment beside a regex in one file while the nav lived in another,
 * so it held for /marketplace and quietly failed for /explorer. One module, compared by a test.
 *
 * The capital surfaces — the receipt, the credit file, the lender view — are shelled for a second
 * reason: unshelled they read as loose documents rather than parts of a system, which is the
 * opposite of what a page about moving money should feel like.
 *
 * /docs is the one deliberate exception. It carries its own sidebar, and offering a stranger a
 * Dashboard link promises an account they do not have.
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
    /^\/lender/.test(p) ||
    /^\/proof\//.test(p)
  );
}

/** The one route the rail offers that deliberately has no shell. */
export const SHELL_EXEMPT: readonly string[] = ["/docs"];
