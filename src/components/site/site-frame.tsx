import "@/styles/site.css";
import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/** Every public company page: the header, the page, the footer. */
export function SiteFrame({ active, children }: { active?: string; children: ReactNode }) {
  return (
    <div className="site">
      <SiteHeader active={active} />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
