"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { House, Sparkles } from "lucide-react";
import { AppRail } from "./app-rail";
import { NetworkChip } from "@/components/app/network-chip";
import { useFounderSession } from "@/lib/auth/use-founder-session";
import { GOAT_MAINNET_CHAIN_ID, STARKNET_MAINNET_KEY } from "@/lib/deputy/networks";
import "./app-shell.css";

/**
 * P27 — the one global app shell. Fixed/floating chrome (hover rail + top-center Home|Agent pill +
 * top-right context pills), mounted once in the root layout in place of the old AgentDock. Shown only
 * on app routes (usePathname); the marketing landing, /proof, /agents/sage and the legacy console get
 * nothing. Sets html[data-app-shell="on"] so page content clears the fixed chrome (see app-shell.css).
 */
// The FOUNDER app surfaces get the shell. The public tester board /c/[slug] does NOT — testers aren't
// founders, so they keep the clean campaign-scoped header instead of the founder rail.
function isAppRoute(p: string): boolean {
  return (
    /^\/dashboard/.test(p) ||
    /^\/campaign\//.test(p) ||
    /^\/launch/.test(p) ||
    /^\/agent(\/|$)/.test(p) ||
    // The marketplace is reachable from the founder rail, so the rail must survive the navigation —
    // a nav item that makes its own chrome disappear is worse than no nav item.
    /^\/marketplace/.test(p)
  );
}

function ModePill({ pathname }: { pathname: string }) {
  const onAgent = pathname.startsWith("/agent");
  return (
    <div className="mode-pill" role="group" aria-label="Mode">
      <Link href="/dashboard" className={`mode-seg${onAgent ? "" : " on"}`}>
        <House size={14} strokeWidth={2} /> Home
      </Link>
      <Link href="/agent" className={`mode-seg${onAgent ? " on" : ""}`}>
        <Sparkles size={14} strokeWidth={2} /> Agent
      </Link>
    </div>
  );
}

function ContextPills() {
  /**
   * Names the SETTLEMENT network, never the browser wallet's incidental chain — a founder whose
   * wallet happens to sit on a testnet must not see a real-money product mislabelled. The wallet's
   * own chain is surfaced during the deploy steps, where it actually matters.
   *
   * But which settlement network that IS now depends on who is signed in. It was hardcoded to
   * GOAT, so a founder signed in with a Starknet wallet read "GOAT Mainnet" on every screen — a
   * chain they hold nothing on and will never settle through.
   */
  const founder = useFounderSession();
  return (
    <div className="ctx-pills">
      <NetworkChip
        chainId={founder.chain === "starknet" ? STARKNET_MAINNET_KEY : GOAT_MAINNET_CHAIN_ID}
      />
    </div>
  );
}

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
  return (
    <>
      <AppRail />
      <ModePill pathname={pathname} />
      <ContextPills />
    </>
  );
}
