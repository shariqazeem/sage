import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * THE ARC NOTE — new, promoted, and honest about where it stands. Arc is Circle's chain, where USDC
 * is the gas. Sage's account runs there on MAINNET since 10 October 2026, beside GOAT and Starknet:
 * real USDC, the first payout settled that day. A note under the hero, not the hero: one line, one
 * link. (It read "testnet today, mainnet the day Arc opens" from 11 Sep until mainnet went live.)
 */
export function ArcNote() {
  return (
    <section className="arcnote" aria-label="New: Sage on Arc">
      <div className="wrap">
        <div className="arcnote-in">
          <span className="arcnote-k">New</span>
          <p className="arcnote-t">
            <b>Sage on Arc.</b> One account anyone can fund with USDC alone — on Circle&apos;s chain, USDC is the gas, so a funded account needs nothing else.
            <span className="arcnote-s"> Live on Arc mainnet · real USDC</span>
          </p>
          <Link href="/docs/arc" className="arcnote-l">How it works <ArrowRight size={14} strokeWidth={2.2} /></Link>
        </div>
      </div>
    </section>
  );
}
