"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { SageMark } from "@/components/brand/sage-mark";

const LINKS = [
  { href: "#how", label: "How Sage works" },
  { href: "#proof", label: "Live proof" },
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
          <Link href="/dashboard" className="nav-cta">
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
          <Link href="/dashboard" className="nav-sheet-cta" onClick={() => setOpen(false)}>
            Launch a campaign
          </Link>
        </div>
      )}
    </header>
  );
}
