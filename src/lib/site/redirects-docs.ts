import type { SiteRedirect } from "./redirects";
import type { DocsHref } from "./docs-pages";

/**
 * Old documentation addresses → the consolidated docs. Owned by the docs.
 *
 * Thirteen pages became five on 19 Oct 2026. Each removed address lands on the section that now
 * holds its content, so a link already shared in a post, a receipt or a chat still answers the
 * question it was sent for. The `#anchor` is a section id on the target page (docs.test.ts holds
 * both lists to it). /docs and /docs/how-it-works kept their addresses.
 */
type Destination = DocsHref | `${DocsHref}#${string}`;

const MOVED: Record<string, Destination> = {
  "/docs/missions": "/docs/how-it-works#jobs",
  "/docs/judging": "/docs/how-it-works#checking",
  "/docs/operator": "/docs/how-it-works#autopilot",
  "/docs/safety": "/docs/trust",
  "/docs/privacy": "/docs/trust#privacy",
  "/docs/compliance": "/docs/trust#compliance",
  "/docs/settlement": "/docs/payments#settlement",
  "/docs/arc": "/docs/payments#networks",
  "/docs/build-on-sage": "/docs/build",
  "/docs/interfaces": "/docs/build#ways-in",
  "/docs/architecture": "/docs/build#architecture",
};

export const DOCS_REDIRECTS: SiteRedirect[] = Object.entries(MOVED).map(([source, destination]) => ({
  source,
  destination,
  permanent: true,
}));
