"use client";

import { usePathname } from "next/navigation";
import { TopBar } from "@/components/sage/top-bar";
import { hasTopBar } from "./routes";

/**
 * THE SHELL: one top bar, mounted once in the root layout, above every page that wears it (see
 * routes.ts for the three that do not). It replaced the hover rail and the company header on
 * 20 Nov 2026. The bar is sticky and in the page's flow, so no page has to make room for it.
 */
export function AppShell() {
  const pathname = usePathname() ?? "";
  if (!hasTopBar(pathname)) return null;
  return <TopBar />;
}
