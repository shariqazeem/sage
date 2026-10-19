/**
 * WHERE OLD ADDRESSES GO (19 Oct 2026: 51 pages fold into a company site and a six-screen app).
 *
 * Every page that was folded keeps its address alive: a link already shared, in a post, a receipt,
 * a Telegram message or a search result, lands on the page that now holds its content. Kept out of
 * next.config so each part of the site owns its own list, and imported there once.
 *
 * Permanent (308) only where the old page is gone for good.
 */
export interface SiteRedirect {
  source: string;
  destination: string;
  permanent: boolean;
}

export const SITE_REDIRECTS: SiteRedirect[] = [];
