import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * Crawl rules.
 *
 * Answer engines are explicitly welcome: being quoted accurately by one is worth more to this product
 * than a click, because the thing being quoted (an agent that pays people and publishes receipts) is
 * checkable. What they must NOT crawl is anything that is one person's private view or a machine
 * surface: the founder dashboard and campaign consoles are wallet-scoped, and /api and /mcp are for
 * programs, not readers.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/mcp", "/dashboard", "/campaign/", "/launch/", "/link/"],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
