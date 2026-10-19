import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { marketplace } from "@/lib/campaigns/marketplace";
import { DOCS_PAGES } from "@/lib/site/docs-pages";

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
    // The company site: what Sage costs, who builds it, its second product, and the public ledger.
    { url: `${base}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/ledger`, lastModified: now, changeFrequency: "hourly", priority: 0.8 },
    { url: `${base}/company`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/called`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    // The docs: five pages, each its own answer to its own question, so each is worth submitting
    // rather than hoping a crawler finds them from one index page. The same list as the sidebar.
    ...DOCS_PAGES.map((page) => ({
      url: `${base}${page.href}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: page.href === "/docs" ? 0.85 : 0.7,
    })),
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
