"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { usd } from "@/lib/format";
import { CountUpLanding } from "./count-up-landing";

const HEADLINE = [
  "Give",
  "an",
  "AI",
  "agent",
  "an",
  "allowance",
  "—", // em dash, its own beat
  "not",
  "your",
  "keys.",
];

/**
 * ACT 1 — THE LINE. Near-empty warm viewport. The one sentence fades in word by
 * word (80ms stagger); the live vault balance counts up from 0 to its real
 * remaining value; one indigo CTA. The 3D hero render sits right of the headline
 * and parallax-drifts at 0.9x scroll speed (disabled on mobile + reduced-motion).
 * Falls back to a styled placeholder until /public/hero-vault.png exists.
 */
export function Act1Hero({
  remaining,
  budget,
  networkName,
  hasHero,
}: {
  remaining: number;
  budget: number;
  networkName: string;
  hasHero: boolean;
}) {
  const mediaRef = useRef<HTMLDivElement>(null);

  // parallax: the hero media lags the page at 0.9x. Passive + rAF-throttled;
  // bails on mobile (measured live, so it survives resize) and reduced-motion.
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const apply = () => {
      raf = 0;
      if (window.innerWidth < 760) {
        el.style.transform = "";
        return;
      }
      const drift = Math.min(window.scrollY * 0.1, 160);
      el.style.transform = `translate3d(0, ${drift}px, 0)`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <section className="clx-act clx-act1" aria-label="Sage">
      <div className="clx-hero-in">
        <div className="clx-hero-copy">
          <div className="clx-pill">
            <span className="clx-dot" />
            <span className="clx-mono">An AI agent with its own wallet</span>
          </div>

          <h1 className="clx-h1">
            {HEADLINE.map((w, i) => (
              <span
                key={i}
                className={`clx-word${w === "—" ? " dash" : ""}`}
                style={{ ["--wi" as string]: i }}
              >
                {w}
              </span>
            ))}
          </h1>

          <div className="clx-hero-balance">
            <span className="clx-bal-k clx-mono">Live wallet balance</span>
            <span className="clx-bal-v">
              <CountUpLanding value={remaining} format={usd} duration={1600} />
            </span>
            <span className="clx-bal-sub clx-mono">
              of {usd(budget)} allowance · {networkName}
            </span>
          </div>

          <div className="clx-hero-actions">
            <Link href="/app" className="clx-cta">
              Hire your first Deputy{" "}
              <ArrowRight size={16} strokeWidth={2.4} />
            </Link>
            <span className="clx-trust clx-mono">
              <Lock size={13} strokeWidth={2} /> It never touches your keys
            </span>
          </div>
        </div>

        <div className="clx-hero-media" ref={mediaRef}>
          {hasHero ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/hero-vault.png"
              alt="An on-chain wallet with hard spending limits — the Policy Vault"
              className="clx-hero-img"
              width={560}
              height={560}
              loading="eager"
            />
          ) : (
            <div className="clx-hero-ph" role="img" aria-label="Policy Vault render">
              <span className="clx-hero-ph-ring" />
              <span className="clx-hero-ph-core">
                <Lock size={30} strokeWidth={1.6} />
              </span>
              <span className="clx-hero-ph-label clx-mono">hero-vault.png</span>
            </div>
          )}
        </div>
      </div>

      <div className="clx-scrollcue clx-mono" aria-hidden="true">
        scroll
      </div>
    </section>
  );
}
