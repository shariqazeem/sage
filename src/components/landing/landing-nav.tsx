"use client";

import { useState } from "react";
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
 * person on that side of the market cares about.
 */
const LINKS = [
  { href: "#how", label: "How it works" },
  // The real ledger, not a section about it.
  { href: "/explorer", label: "Live proof" },
  // The market has two sides. The landing sells the founder side; this is the only door for the
  // people who do the work, and without it a tester can only arrive via a link a founder sent them.
  { href: "/marketplace", label: "Find work" },
  // Docs sit in the nav rather than only the footer: they are the surface that answers
  // "is this real and how does it work" for a founder who is not ready to click Launch.
  { href: "/docs", label: "Docs" },
  { href: "/dashboard", label: "Dashboard" },
];

/**
 * The floating landing navigation — a compact warm capsule that stays out of the way.
 * On mobile the links collapse into a real toggled sheet (not a scaled-down desktop
 * bar). The primary CTA is always reachable.
 */
export function LandingNav() {
  const [open, setOpen] = useState(false);
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
          <Link href="/launch" className="nav-cta">
            Launch a campaign
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
          <Link href="/launch" className="nav-sheet-cta" onClick={() => setOpen(false)}>
            Launch a campaign
          </Link>
        </div>
      )}
    </header>
  );
}
