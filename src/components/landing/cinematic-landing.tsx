import Link from "next/link";
import type { PayoutReceipt } from "@/lib/deputy/chain";
import type { EcosystemStatus } from "@/lib/ecosystem/status";
import { EcosystemStrip } from "@/components/ecosystem/ecosystem-strip";
import { SageMark } from "@/components/brand/sage-mark";
import { geist } from "./fonts";
import { LandingNav } from "./landing-nav";
import { SceneHero } from "./scene-hero";
import { SceneWorkflow } from "./scene-workflow";
import { SceneReplay } from "./scene-replay";
import { ScenePolicy } from "./scene-policy";
import { SceneProof } from "./scene-proof";
import { SceneClose } from "./scene-close";

interface Props {
  network: { name: string; chainId: number };
  totals: { paidUsd: number; payoutCount: number; blockedCount: number };
  feed: PayoutReceipt[];
  perTxCap: number | null;
  now: number;
  ecosystem: EcosystemStatus;
}

/**
 * Sage landing V2 — a cinematic sequence following SEE → DESIGN → REPLAY → PAY. This
 * shell is a Server Component: it hands each scene its numbers, all derived from ONE
 * source (`feed`) so nothing on the page can contradict. Only motion leaves (Reveal,
 * nav toggle, replay toggle) are client islands.
 */
export function CinematicLanding({ network, totals, feed, perTxCap, now, ecosystem }: Props) {
  return (
    <div className={`slv2 ${geist.variable}`}>
      <LandingNav />

      <main>
        <SceneHero
          paidUsd={totals.paidUsd}
          payoutCount={totals.payoutCount}
          networkName={network.name}
        />

        <SceneWorkflow />

        <SceneReplay />

        <ScenePolicy perTxCap={perTxCap} />

        <SceneProof feed={feed} totals={totals} networkName={network.name} now={now} />

        <SceneClose totals={totals} networkName={network.name} />
      </main>

      <footer className="foot">
        <div className="wrap foot-in">
          <Link href="/" className="nav-brand" aria-label="Sage home">
            <SageMark size={18} />
            <span>Sage</span>
          </Link>
          <span className="mono foot-tag">
            An agent with eyes, judgment, and a wallet · {network.name}
          </span>
          <nav className="foot-nav" aria-label="Footer">
            <a href="#how">How Sage works</a>
            <a href="#proof">Live proof</a>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/agents/sage">Agent record</Link>
          </nav>
        </div>
        <div className="wrap foot-eco">
          <EcosystemStrip status={ecosystem} />
        </div>
      </footer>
    </div>
  );
}
