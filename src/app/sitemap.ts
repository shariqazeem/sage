import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { marketplace } from "@/lib/campaigns/marketplace";

export const dynamic = "force-dynamic";

/**
 * The sitemap. Static surfaces plus every campaign board a tester can actually open.
 *
 * Only listable campaigns are included, and that is the same set the marketplace shows: live, funded,
 * mainnet, with an unfilled slot. Submitting URLs for work nobody can be paid for would put pages in
 * the index that dead-end the person who clicks them.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const now = new Date();

  const statics: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/marketplace`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/launch`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/agents/sage`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    // The citable surfaces: an FAQ and two comparisons. Higher priority than the agent profile
    // because these are the pages written to be quoted by an answer engine, and a page that is not
    // in the sitemap is a page we are hoping gets found rather than asking for it to be.
    { url: `${base}/faq`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/docs`, lastModified: now, changeFrequency: "monthly", priority: 0.85 },
    { url: `${base}/vs/beta-testers`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/vs/bug-bounty`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    // The case study: the one content shape that carries real numbers rather than an explanation of
    // how the product works, which is what makes it the most quotable page on the site.
    {
      url: `${base}/case-studies/autonomous-paid-testing`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
  ];

  let boards: MetadataRoute.Sitemap = [];
  try {
    boards = marketplace().campaigns.map((c) => ({
      url: `${base}${c.boardPath}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.8,
    }));
  } catch {
    // A sitemap that throws takes the whole route down; the static entries are still worth serving.
  }

  return [...statics, ...boards];
}
