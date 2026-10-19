import { BookOpen, Code2, Coins, ShieldCheck, Workflow } from "lucide-react";

/**
 * THE DOCS: FIVE PAGES (19 Oct 2026, folded from thirteen). The sidebar, the previous and next
 * links, the overview's map, the sitemap and the old-address redirects all read this one list, so
 * a page can't be added in one place and forgotten in another.
 *
 * Plain data on purpose: the sidebar is a client component and the sitemap runs on the server,
 * and both import it.
 */
export const DOCS_PAGES = [
  {
    href: "/docs",
    title: "Overview",
    summary: "What Sage is, how a job runs, and how to start.",
    icon: BookOpen,
  },
  {
    href: "/docs/how-it-works",
    title: "How it works",
    summary: "Jobs and missions, how work is checked, Autopilot, and what you see.",
    icon: Workflow,
  },
  {
    href: "/docs/trust",
    title: "Safety and limits",
    summary: "The limits no model can cross, farm defences, refusals, privacy and compliance.",
    icon: ShieldCheck,
  },
  {
    href: "/docs/payments",
    title: "Payments and networks",
    summary: "How a payout settles, the networks, receipts, fees, and how plans are billed.",
    icon: Coins,
  },
  {
    href: "/docs/build",
    title: "Build on Sage",
    summary: "The MCP server, the API, Telegram, and how the system fits together.",
    icon: Code2,
  },
] as const;

export type DocsPage = (typeof DOCS_PAGES)[number];
export type DocsHref = DocsPage["href"];
