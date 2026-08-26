"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BookOpen, House, Rocket, Sparkles, Send, Wallet, Compass } from "lucide-react";
import { SageMark } from "@/components/brand/sage-mark";
import { useSiwe } from "@/lib/auth/use-siwe";

/**
 * P27 — the floating hover-expand rail (Adaption-style, on Sage's light system). Collapsed it's a slim
 * icon column; on hover it glides open into a labelled card (brand → nav → invite + wallet). Nav items
 * are real routes; active state comes from usePathname(). On mobile it reflows to a bottom icon bar (CSS).
 */
const NAV = [
  { href: "/dashboard", label: "Home", Icon: House },
  { href: "/launch", label: "Launch", Icon: Rocket },
  { href: "/marketplace", label: "Marketplace", Icon: Compass },
  { href: "/agent", label: "Agent", Icon: Sparkles },
  // The credibility surface — safety, compliance, settlement. Now that the product is broader
  // than testing, "is this real and how does it work" needs a door inside the app too.
  { href: "/docs", label: "Docs", Icon: BookOpen },
] as const;

function short(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function AppRail() {
  const pathname = usePathname() ?? "";
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const siwe = useSiwe();

  const isActive = (href: string): boolean => {
    const base = href.split("?")[0];
    if (base === "/dashboard") return pathname === "/dashboard";
    if (base === "/agent") return pathname.startsWith("/agent");
    return pathname.startsWith(base);
  };

  const invite = () => {
    const url = typeof window !== "undefined" ? window.location.origin : "https://sagepays.xyz";
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div
      className={`app-rail${expanded ? " is-expanded" : ""}`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <nav className="app-rail-card">
        {/* The mark goes HOME — the public landing — not to the dashboard. "Home" already has its
            own rail item; a brand mark that lands you where you already are is a dead click. */}
        <Link href="/" className="app-rail-brand" aria-label="Sage home">
          <SageMark size={20} />
          <span className="app-rail-label">sage</span>
        </Link>
        {NAV.map(({ href, label, Icon }) => (
          <Link
            key={label}
            href={href}
            className={`app-rail-item${isActive(href) ? " on" : ""}`}
            title={label}
            aria-label={label}
          >
            <Icon size={19} strokeWidth={1.9} />
            <span className="app-rail-label">{label}</span>
          </Link>
        ))}
      </nav>

      <button
        className="app-rail-pill app-rail-invite"
        onClick={invite}
        title="Invite your team"
        type="button"
      >
        <Send size={18} strokeWidth={1.9} />
        <span className="app-rail-label">{copied ? "Link copied!" : "Invite your team"}</span>
      </button>

      {siwe.authedAddress ? (
        <div className="app-rail-pill app-rail-user" title={siwe.authedAddress}>
          <span className="app-rail-avatar">
            <Wallet size={14} strokeWidth={2} />
          </span>
          <span className="app-rail-label">
            <span className="mono">{short(siwe.authedAddress)}</span>
            <span className="app-rail-sub">Founder</span>
          </span>
        </div>
      ) : (
        <button
          className="app-rail-pill app-rail-user"
          onClick={() => void siwe.signIn()}
          title="Connect wallet"
          type="button"
        >
          <span className="app-rail-avatar">
            <Wallet size={14} strokeWidth={2} />
          </span>
          <span className="app-rail-label">{siwe.signingIn ? "Connecting…" : "Connect wallet"}</span>
        </button>
      )}
    </div>
  );
}
