"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { SageMark } from "@/components/brand/sage-mark";

/**
 * FOUR DESTINATIONS AND A CTA — one per audience, and no anchors pretending to be pages.
 *
 * "Live proof" used to scroll to a landing SECTION while /explorer — the actual public ledger of
 * every settlement and every refusal — was reachable only by typing the URL. The most
 * credibility-building surface in the product was orphaned behind a marketing anchor. For a
 * payments layer, a live ledger is worth more than a paragraph about one.
 *
 * "Marketplace" said what the page IS; "Find work" says what it is FOR, which is the only thing the
 * person on that side of the market cares about — and it is back in the bar, first, because the
 * people who return daily are the ones looking for work, not the ones reading about the product.
 *
 * The CTA is session-aware. It said "Sign in" to everyone, including the people who already were,
 * and the mobile sheet said something else entirely ("Launch a campaign"). One door, and it names
 * what pressing it does: put Sage to work, or open it if you already have.
 */
// Three links and one door. Everything else lives inside the product, after sign-in.
const LINKS = [
  { href: "/marketplace", label: "Find work" },
  { href: "/verify", label: "Get verified" },
  { href: "#how", label: "How it works" },
  { href: "/explorer", label: "Live proof" },
  { href: "/lender", label: "For lenders" },
  { href: "/docs", label: "Docs" },
];

/**
 * The floating landing navigation — a compact warm capsule that stays out of the way.
 * On mobile the links collapse into a real toggled sheet (not a scaled-down desktop
 * bar). The primary CTA is always reachable.
 */
export function LandingNav() {
  const [open, setOpen] = useState(false);
  // The door used to say "Sign in" to everyone, including people who already were — so the one
  // control on the page was wrong for every returning founder. It now says what pressing it does.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch("/api/auth/founder", { cache: "no-store" })
      .then(async (r) => {
        if (!alive) return;
        const j = r.ok ? ((await r.json()) as { address?: string }) : null;
        setSignedIn(Boolean(j?.address));
      })
      .catch(() => alive && setSignedIn(false));
    return () => { alive = false; };
  }, []);
  const door = signedIn ? { href: "/workspace", label: "Open Sage" } : { href: "/start", label: "Put Sage to work" };
  return (
    <header className="nav" data-open={open ? "1" : "0"}>
      <div className="nav-in">
        <Link href="/" className="nav-brand" aria-label="Sage home">
          <SageMark size={20} />
          <span>Sage</span>
        </Link>
        <nav className="nav-links" aria-label="Primary">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
          <Link href={door.href} className="nav-cta">
            {door.label}
          </Link>
        </nav>
        <button
          type="button"
          className="nav-burger"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>
      {open && (
        <div className="nav-sheet">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          <Link href={door.href} className="nav-sheet-cta" onClick={() => setOpen(false)}>
            {door.label}
          </Link>
        </div>
      )}
    </header>
  );
}
