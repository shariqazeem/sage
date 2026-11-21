/**
 * WHERE YOUR USERS ARE: a short, vetted list per kind of product (21 Nov 2026).
 *
 * Deterministic: keyed by the inspection's own category (`inferCategory`, src/lib/launch/product-map.ts)
 * and written by hand. A venue is here only if it is certain to exist and its rule about showing your own
 * work is stated the way the venue states it. Posting where it is not welcome gets a builder banned, so
 * a venue whose rule was not certain was left out, and so was every Discord, Slack and Facebook group
 * (their rules change with their moderators). Each community still has the last word: the note says so.
 *
 * A venue that closes leaves the list: DappRadar (a dapp directory) shut down in November 2025.
 */
export interface Venue {
  name: string;
  url: string;
  /** its rule about showing your own work, in one line */
  rule: string;
}

const SHOW_HN: Venue = {
  name: "Hacker News: Show HN",
  url: "https://news.ycombinator.com/showhn.html",
  rule: "Only for something people can try right now. A landing page, a waitlist or a blog post is not a Show HN. Be there to answer.",
};
const HN_LINK: Venue = {
  name: "Hacker News",
  url: "https://news.ycombinator.com/newsguidelines.html",
  rule: "Reading material goes in as an ordinary link, never as Show HN. Submitting your own work now and then is fine; using the site mainly to promote is not.",
};
const PRODUCT_HUNT: Venue = {
  name: "Product Hunt",
  url: "https://www.producthunt.com",
  rule: "Built for launching your own product. Ask people to take a look and comment; asking for upvotes is against its rules.",
};
const SIDE_PROJECT: Venue = {
  name: "r/SideProject",
  url: "https://www.reddit.com/r/SideProject/",
  rule: "Sharing your own project is what it is for. Say what you built and ask for feedback.",
};
const ALPHA_BETA: Venue = {
  name: "r/alphaandbetausers",
  url: "https://www.reddit.com/r/alphaandbetausers/",
  rule: "Made for finding early testers: post what it is and what you want tested.",
};
const WEBDEV: Venue = {
  name: "r/webdev",
  url: "https://www.reddit.com/r/webdev/",
  rule: "Your own work goes up only on Showoff Saturday, not on other days.",
};
const STARTUPS: Venue = {
  name: "r/startups",
  url: "https://www.reddit.com/r/startups/",
  rule: "No promotion in posts. Your product goes only in its Share Your Startup thread.",
};
const DEV_TO: Venue = {
  name: "DEV",
  url: "https://dev.to/t/showdev",
  rule: "Write a post about what you built and tag it #showdev, the tag for showing your own project.",
};
const BETALIST: Venue = {
  name: "BetaList",
  url: "https://betalist.com",
  rule: "A directory of early-stage startups. You submit your own, and it is reviewed before it is listed.",
};
const INDIE_HACKERS: Venue = {
  name: "Indie Hackers",
  url: "https://www.indiehackers.com",
  rule: "Founders sharing what they are building. Write what you learned, with your numbers; a bare link reads as an ad.",
};
const FARCASTER: Venue = {
  name: "Farcaster",
  url: "https://farcaster.xyz",
  rule: "Where many crypto builders post. There is no one rule on showing your work: each channel sets its own, so read it first.",
};

export const DEFAULT_CATEGORY = "product (uncategorized)";

/** Keyed by `inferCategory`'s own strings; `venues.test.ts` holds the two lists together. */
export const VENUES: Record<string, readonly Venue[]> = {
  "web3 / crypto": [FARCASTER, PRODUCT_HUNT, SHOW_HN, SIDE_PROJECT],
  "developer tool / docs": [SHOW_HN, DEV_TO, WEBDEV, PRODUCT_HUNT],
  "commerce / saas": [PRODUCT_HUNT, INDIE_HACKERS, SIDE_PROJECT, STARTUPS, BETALIST],
  "saas app": [PRODUCT_HUNT, SHOW_HN, INDIE_HACKERS, SIDE_PROJECT, BETALIST],
  "content / media": [HN_LINK, INDIE_HACKERS, SIDE_PROJECT],
  "messaging / social": [PRODUCT_HUNT, SIDE_PROJECT, ALPHA_BETA, BETALIST],
  "login-walled product": [ALPHA_BETA, SIDE_PROJECT, PRODUCT_HUNT, BETALIST],
  [DEFAULT_CATEGORY]: [PRODUCT_HUNT, SHOW_HN, SIDE_PROJECT, INDIE_HACKERS],
};

export function venuesFor(category: string | null | undefined): readonly Venue[] {
  return VENUES[category ?? ""] ?? VENUES[DEFAULT_CATEGORY]!;
}
