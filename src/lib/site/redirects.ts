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
  // The comparison pages, the case study, the Caribbean page and the FAQ are PAGES again (restored
  // 20 Oct 2026, in the company frame): an address someone may still hold is never folded away when
  // the page under it is worth reading. Only a page whose content truly moved redirects.
  // The old "hire an AI worker" page: starting is one door now.
  { source: "/hire", destination: "/start", permanent: true },
  // A development-only preview (it 404s in production): nothing a stranger could have been sent.
  { source: "/dev/:path*", destination: "/", permanent: true },
  // The founder's list of work is Jobs, one of the app's six screens.
  { source: "/dashboard", destination: "/workspace/jobs", permanent: true },
  { source: "/campaigns", destination: "/workspace/jobs", permanent: true },
  { source: "/campaigns/new", destination: "/launch", permanent: true },
  // The second product was called Called for a few days (19-24 Oct 2026); the founder took its original
  // name, ParallaxPay, back before mainnet. Its page moved; a link someone holds lands on it.
  { source: "/called", destination: "/parallaxpay", permanent: true },
];
