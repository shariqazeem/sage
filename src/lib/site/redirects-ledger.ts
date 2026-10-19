import type { SiteRedirect } from "./redirects";

/**
 * The explorer and outcomes pages → the ledger. Owned by the ledger.
 *
 * Both were single pages with no sub-routes and no query parameters of their own (the explorer's
 * search routed in the browser, straight to /proof and /record), so each maps to the ledger whole. A
 * query string on an old link is carried through, and the ledger ignores what it does not know.
 */
export const LEDGER_REDIRECTS: SiteRedirect[] = [
  { source: "/explorer", destination: "/ledger", permanent: true },
  { source: "/outcomes", destination: "/ledger", permanent: true },
];
