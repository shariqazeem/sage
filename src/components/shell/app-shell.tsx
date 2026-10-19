"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { AppRail } from "./app-rail";
import "./app-shell.css";
import { isAppRoute } from "./routes";

/**
 * P27 — the one global app shell. Fixed/floating chrome (hover rail + top-center Home|Agent pill +
 * top-right context pills), mounted once in the root layout in place of the old AgentDock. Shown only
 * on app routes (usePathname); the marketing landing, /proof, /agents/sage and the legacy console get
 * nothing. Sets html[data-app-shell="on"] so page content clears the fixed chrome (see app-shell.css).
 */
export function AppShell() {
  const pathname = usePathname() ?? "";
  const active = isAppRoute(pathname);

  useEffect(() => {
    const el = document.documentElement;
    if (active) el.dataset.appShell = "on";
    else delete el.dataset.appShell;
    return () => {
      delete el.dataset.appShell;
    };
  }, [active]);

  if (!active) return null;
  // One piece of chrome: the rail. Networks live on the Account screen and in Settings, and the
  // agent chat is reached from Settings, so neither needs a floating pill over every page.
  return <AppRail />;
}
