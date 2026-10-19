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

export const SITE_REDIRECTS: SiteRedirect[] = [
  // Comparison pages, the case study and the Caribbean page: their stories are the home page's
  // use cases now (testing, gigs, milestone grants in local currency).
  { source: "/vs/:path*", destination: "/", permanent: true },
  { source: "/case-studies/:path*", destination: "/", permanent: true },
  { source: "/caribbean", destination: "/", permanent: true },
  // The old "hire an AI worker" page: starting is one door now.
  { source: "/hire", destination: "/start", permanent: true },
  { source: "/dev/:path*", destination: "/", permanent: true },
  { source: "/faq", destination: "/docs", permanent: true },
  // The founder's list of work is Jobs, one of the app's six screens.
  { source: "/dashboard", destination: "/workspace/jobs", permanent: true },
  { source: "/campaigns", destination: "/workspace/jobs", permanent: true },
  { source: "/campaigns/new", destination: "/launch", permanent: true },
];
