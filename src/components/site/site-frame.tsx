import "@/styles/site.css";
import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";

/**
 * Every public company page: the page, then the footer. The header is the one top bar now, mounted
 * in the root layout for every page (relaunch, 20 Nov 2026), so a company page no longer draws its
 * own. `active` is still accepted so the pages that pass it need no edit; the bar marks its own place.
 */
export function SiteFrame({ children }: { active?: string; children: ReactNode }) {
  return (
    <div className="site">
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
