import type { SiteRedirect } from "./redirects";

/**
 * The explorer → the ledger. Owned by the ledger.
 *
 * The explorer was a single page with no sub-routes and no query parameters of its own (its search
 * routed in the browser, straight to /proof and /record), and the ledger is the same list with more
 * on it, so it maps to the ledger whole. A query string on an old link is carried through, and the
 * ledger ignores what it does not know.
 *
 * /outcomes folded here on 19 Oct 2026 and became its own page again on 20 Oct: the ledger lists what
 * happened, the outcomes page argues from it (cost, speed, access, flow), and the two read the same
 * derivations (src/lib/site/readings.ts).
 */
export const LEDGER_REDIRECTS: SiteRedirect[] = [{ source: "/explorer", destination: "/ledger", permanent: true }];
