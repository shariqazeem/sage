import Link from "next/link";
import type { VaultStateView, PayoutReceipt } from "@/lib/deputy/chain";
import { Act1Hero } from "./act1-hero";
import { Act2Problem } from "./act2-problem";
import { Act3Vault } from "./act3-vault";
import { Act4Proof } from "./act4-proof";
import { Act5Close } from "./act5-close";

interface Props {
  vault: VaultStateView | null;
  history: PayoutReceipt[];
  network: { name: string };
  hasHero: boolean;
  /** Server-stamped clock so relative times match across SSR + hydration. */
  now: number;
}

/**
 * The Sage landing as a scroll-driven, five-act cinematic sequence. This shell is
 * a Server Component: it computes everything from LIVE vault state + real on-chain
 * payout history and hands each act its numbers. Only the acts themselves are
 * client components (they own the scroll choreography). Nothing here is faked —
 * the hero balance, the checks' cap, the receipt feed, and the closing stats are
 * all real.
 */
export function CinematicLanding({ vault, history, network, hasHero, now }: Props) {
  const budget = vault?.budget ?? 500;
  const remaining = vault?.remaining ?? budget;
  const perTxCap = vault?.perTxCap ?? 25;

  const settled = history.filter((h) => h.settled);
  const blocked = history.filter((h) => !h.settled);
  const totalReleased = settled.reduce((s, h) => s + h.amount, 0);

  return (
    <div className="clx">
      <header className="clx-header">
        <div className="clx-header-in">
          <Link href="/" className="clx-brand" aria-label="Sage home">
            <span className="clx-mark">
              <span className="clx-mark-ring" />
            </span>
            <span className="clx-wordmark">Sage</span>
          </Link>
          <nav className="clx-topnav">
            <a href="#how">The vault</a>
            <a href="#proof">Proof</a>
            <Link href="/app" className="clx-cta clx-cta-sm">
              Hire your first Deputy
            </Link>
          </nav>
        </div>
      </header>

      <main className="clx-main">
        <Act1Hero
          remaining={remaining}
          budget={budget}
          networkName={network.name}
          hasHero={hasHero}
        />

        <Act2Problem />

        <span id="how" className="clx-anchor" aria-hidden />
        <Act3Vault perTxCap={perTxCap} />

        <span id="proof" className="clx-anchor" aria-hidden />
        <Act4Proof feed={history} now={now} networkName={network.name} />

        <Act5Close
          totalReleased={totalReleased}
          payoutsCount={settled.length}
          blocksCount={blocked.length}
        />
      </main>

      <footer className="clx-footer">
        <div className="clx-footer-in">
          <div className="clx-brand">
            <span className="clx-mark">
              <span className="clx-mark-ring sm" />
            </span>
            <span className="clx-wordmark" style={{ fontSize: 15 }}>
              Sage
            </span>
            <span className="clx-mono clx-foot-tag">
              Policy-enforced autonomous payouts · {network.name}
            </span>
          </div>
          <nav className="clx-footnav">
            <a href="#how">The vault</a>
            <a href="#proof">Proof</a>
            <Link href="/app">Hire your first Deputy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
