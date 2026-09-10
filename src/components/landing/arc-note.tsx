import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * THE ARC NOTE — new, promoted, and honest about where it stands. Arc is Circle's chain, where USDC
 * is the gas; Sage's account works there today on testnet and moves to mainnet the day Arc opens
 * (16 September 2026), when it becomes the default rail. Until then GOAT and Starknet carry the real
 * money, so this is a note under the hero, not the hero: one line, one chip that says testnet, one
 * link. The founder's rule of 11 Sep: "add arc as highlighted promotion or upcoming that rn works on
 * testnet, soon on mainnet".
 */
export function ArcNote() {
  return (
    <section className="arcnote" aria-label="New: Sage on Arc">
      <div className="wrap">
        <div className="arcnote-in">
          <span className="arcnote-k">New</span>
          <p className="arcnote-t">
            <b>Sage on Arc.</b> One account anyone can fund with USDC alone — on Circle&apos;s chain, USDC is the gas, so a funded account needs nothing else.
            <span className="arcnote-s"> Working on Arc testnet today · mainnet the day Arc opens, 16 September</span>
          </p>
          <Link href="/docs/arc" className="arcnote-l">How it works <ArrowRight size={14} strokeWidth={2.2} /></Link>
        </div>
      </div>
    </section>
  );
}
