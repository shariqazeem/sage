/**
 * WHERE THE APP SHELL LIVES — the single definition, imported by both the rail and the shell.
 *
 * THE RULE: if the rail links to it, the rail survives it. A nav item that makes its own chrome
 * disappear is worse than no nav item — you arrive somewhere with no way back but the logo.
 *
 * Since 19 Oct 2026 there are two worlds. The APP is a founder's six screens (Home, Post, Jobs,
 * Account, Team, Settings) and the pages they open: a job, its graph, the agent chat. The first
 * run (/start) and an invite (/join/<code>) have no rail: someone arriving has nothing to navigate
 * yet, and an invited worker is not a founder. Everything a stranger reads is the COMPANY SITE, with its own header
 * (src/components/site): the home page, pricing, the ledger, the docs, and the pages people are
 * sent to (a receipt, a work record, a board, finding work).
 *
 * /proof/[tx] is the most-shared thing Sage produces. It is a RECEIPT — usually opened by someone
 * who has never heard of Sage — so it never wears founder chrome.
 */
export function isAppRoute(p: string): boolean {
  return (
    /^\/workspace(\/|$)/.test(p) ||
    /^\/launch/.test(p) ||
    /^\/campaign\//.test(p) ||
    /^\/graph\//.test(p) ||
    /^\/agent(\/|$)/.test(p)
  );
}
