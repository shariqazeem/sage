/**
 * THE SHELL, IN ONE PLACE (relaunch, 20 Nov 2026): one top bar on every page, and no rail.
 *
 * Until the relaunch there were two worlds: a six-screen app behind a hover rail, and a company site
 * with its own header. The founder asked for the SaaS feel to go, so both headers became ONE bar:
 * the mark, Tests, Earn, New test, and who is signed in. The six screens under /workspace are all
 * still there (the founder's rule: no route is ever removed) and are reached from the account sheet,
 * which opens from the avatar.
 *
 * `BAR_NAV` is the bar's whole list, and a test holds it, because two lists in two files have
 * drifted here before (a link once sat in the rail and destroyed the rail when clicked).
 */
export const BAR_NAV = [
  { href: "/", label: "Tests" },
  { href: "/earn", label: "Earn" },
] as const;

/** "New test" puts the cursor in the paste box on Home. */
export const NEW_TEST_HREF = "/#paste";

/** The screens the rail used to hold. Reached from the account sheet now, and never removed. */
export const ACCOUNT_LINKS = [
  { href: "/workspace/jobs", label: "Jobs" },
  { href: "/workspace/account", label: "Sage account" },
  { href: "/workspace/people", label: "Team" },
  { href: "/workspace/settings", label: "Settings" },
] as const;

/**
 * Which place a page belongs to, for the bar's marker: a test and everything a builder does to one
 * is Tests; a board, a record and the tester's own pages are Earn; a company page is neither.
 */
export function barPlace(p: string): "/" | "/earn" | null {
  if (p === "/" || /^\/(t|launch|campaign|graph)(\/|$)/.test(p) || /^\/workspace\/jobs(\/|$)/.test(p)) return "/";
  if (/^\/(earn|c|record|claim|verify)(\/|$)/.test(p)) return "/earn";
  return null;
}

/**
 * Does this page wear the bar? Every page does, except the three that are deliberately bare:
 *  - /proof/<tx> is a RECEIPT, the most-shared thing Sage makes, usually opened by someone who has
 *    never heard of Sage. It is a document and wears no chrome;
 *  - /start and /join/<code> are focused first runs, with nothing yet to navigate.
 */
export function hasTopBar(p: string): boolean {
  return !(/^\/proof\//.test(p) || /^\/start(\/|$)/.test(p) || /^\/join\//.test(p));
}

/**
 * The pages a founder works in (the old six screens and what they open). Nothing draws chrome from
 * this any more; it remains the one definition of "an app page" for the tests that keep company
 * pages and documents apart from it.
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
