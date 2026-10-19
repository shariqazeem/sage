import type { ReactNode } from "react";
import { SiteFrame } from "@/components/site/site-frame";
import { DocsNav, DocsPager } from "@/components/site/docs-nav";
import "@/styles/docs-site.css";

/**
 * THE DOCS FRAME: the company header and footer, the five-page sidebar, one reading column, and the
 * previous and next links under it. Each page under /docs is only its own content.
 */
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <SiteFrame active="/docs">
      <div className="site-wrap docs">
        <DocsNav />
        <div className="docs-main">
          {children}
          <DocsPager />
        </div>
      </div>
    </SiteFrame>
  );
}
