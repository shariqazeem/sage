"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Blocks, BookOpen, Compass, House, Landmark, Rocket, Send, Settings, Sparkles, Users, Wallet } from "lucide-react";
import { SageMark } from "@/components/brand/sage-mark";
import { useSiwe } from "@/lib/auth/use-siwe";
import { useFounderSession } from "@/lib/auth/use-founder-session";

/**
 * P27 — the floating hover-expand rail (Adaption-style, on Sage's light system). Collapsed it's a slim
 * icon column; on hover it glides open into a labelled card (brand → nav → invite + wallet). Nav items
 * are real routes; active state comes from usePathname(). On mobile it reflows to a bottom icon bar (CSS).
 */
/**
 * TWO GROUPS, BECAUSE THE GROUPING IS THE NARRATIVE.
 *
 * Six items was the stated ceiling for a FLAT list — past that a rail stops being navigation and
 * becomes a sitemap. Labelled groups change that arithmetic: nobody scans eight, they scan two
 * headings and then four items under one of them.
 *
 * And the split says what the product is. WORK is money going out — define it, fund it, let the
 * agent pay it. CAPITAL is money proven — every payout and refusal on chain, and the verified
 * cash flow a lender can advance against. Sage is the cash-flow oracle; the rail should read that
 * way before a single word of copy does.
 *
 * `/record/[wallet]` is deliberately NOT here. It is one person's credit file, so it belongs where
 * a person is named — a receipt, an explorer row — not in global chrome where it has no subject.
 */
// SAGE FOR TEAMS (2026-09-04): the rail is the workspace. Six items, one group of work and one of
// account; the capital surfaces (/explorer, /outcomes, /lender) and the public board stay reachable
// from the pages and the docs that need them, not from global chrome where a new team saw eleven
// doors and opened none.
const NAV = [
  {
    group: "Workspace",
    items: [
      { href: "/workspace", label: "Home", Icon: House },
      { href: "/dashboard", label: "Work", Icon: Blocks },
      { href: "/launch", label: "Post work", Icon: Rocket },
      { href: "/workspace/autopilot", label: "Let Sage run it", Icon: Compass },
      { href: "/workspace/people", label: "People", Icon: Users },
      { href: "/agent", label: "Agent", Icon: Sparkles },
    ],
  },
  {
    group: "Account",
    items: [
      { href: "/workspace/capital", label: "Capital", Icon: Landmark },
      { href: "/workspace/settings", label: "Settings", Icon: Settings },
      { href: "/docs", label: "Docs", Icon: BookOpen },
    ],
  },
] as const;

/** Every route the rail offers — the shell must survive all of them. Held by a test. */
export const RAIL_ROUTES: readonly string[] = NAV.flatMap((g) => g.items.map((i) => i.href));

function short(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function AppRail() {
  const pathname = usePathname() ?? "";
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const siwe = useSiwe();
  const founder = useFounderSession();
  // Either session counts as signed in; the rail is identity chrome, not an EVM control.
  const signedInAs = founder.address ?? siwe.authedAddress ?? "";
  /**
   * "Still asking" is not "signed out", and the rail used to render them identically.
   *
   * A founder looking at their own campaign console saw "Sign in" in the sidebar while they were
   * signed in, because the session fetch had not answered yet — and there is no way to tell that
   * from a wrong answer. Nothing is claimed until the answer arrives.
   */
  const stillAsking = founder.loading && !siwe.authedAddress;

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
        {NAV.map(({ group, items }) => (
          <div key={group} className="app-rail-group">
            {/* Collapsed, the rail is an icon column and a heading would be a stray word, so the
                label rides the same reveal as every other label. */}
            <span className="app-rail-grouplabel app-rail-label">{group}</span>
            {items.map(({ href, label, Icon }) => (
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
          </div>
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

      {stillAsking ? (
        <div className="app-rail-pill app-rail-user" aria-hidden>
          <span className="app-rail-avatar">
            <Wallet size={14} strokeWidth={2} />
          </span>
          <span className="app-rail-label">…</span>
        </div>
      ) : signedInAs ? (
        <div className="app-rail-pill app-rail-user" title={signedInAs}>
          <span className="app-rail-avatar">
            <Wallet size={14} strokeWidth={2} />
          </span>
          <span className="app-rail-label">
            <span className="mono">{short(signedInAs)}</span>
            <span className="app-rail-sub">Founder</span>
          </span>
        </div>
      ) : (
        // The rail is chrome, not the place to render a wallet list. It sends a signed-out
        // visitor to the dashboard, which offers every wallet family — rather than firing
        // MetaMask directly, which is a door a Starknet founder cannot walk through.
        <Link
          className="app-rail-pill app-rail-user"
          href="/dashboard"
          title="Sign in"
        >
          <span className="app-rail-avatar">
            <Wallet size={14} strokeWidth={2} />
          </span>
          <span className="app-rail-label">Sign in</span>
        </Link>
      )}
    </div>
  );
}
