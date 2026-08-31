import Link from "next/link";
import type { PayoutReceipt } from "@/lib/deputy/chain";
import type { EcosystemStatus } from "@/lib/ecosystem/status";
import { EcosystemStrip } from "@/components/ecosystem/ecosystem-strip";
import { SageMark } from "@/components/brand/sage-mark";
import { geist } from "./fonts";
import { LandingNav } from "./landing-nav";
import { SceneHero } from "./scene-hero";
import { SceneLoop } from "./scene-loop";
import { SceneWorkflow } from "./scene-workflow";
import { SceneProof } from "./scene-proof";
import { SceneCapital } from "./scene-capital";
import { ScenePrivacy } from "./scene-privacy";
import { SceneClose } from "./scene-close";

interface Props {
  network: { name: string; chainId: number };
  totals: { paidUsd: number; payoutCount: number; blockedCount: number };
  feed: PayoutReceipt[];
  now: number;
  ecosystem: EcosystemStatus;
}

/**
 * Sage landing V2 — TARGETED (FC Phase 2): one arc, five scenes — what it is (Hero) → how it
 * works (Workflow) → one loop for any work, with real receipts (Loop) → live proof (Proof) →
 * close. The Partners strip lives in the footer's ecosystem strip; the interactive Replay demo
 * and the Policy panel were cut deliberately — their one-line essence lives in the hero, the Loop
 * panel, and /docs/compliance. Showing everything is what an app does; infrastructure shows the
 * primitive and the receipts. Server Component; numbers all derive from ONE source (`feed`).
 */
export function CinematicLanding({ network, totals, feed, now, ecosystem }: Props) {
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

        <SceneLoop />

        <SceneProof feed={feed} totals={totals} networkName={network.name} now={now} />

        {/* The argument in order: the money moved and you can check it · it moved without exposing
            the person · and what it leaves behind is underwritable. */}
        <ScenePrivacy />

        {/* After the ledger, never before it: "a file you can lend against" is a claim nobody
            should accept until they have seen the receipts it is built from. */}
        <SceneCapital totals={totals} />

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
            <Link href="/explorer">Explorer</Link>
            <Link href="/docs">Docs</Link>
            <Link href="/docs/compliance">Compliance</Link>
            <Link href="/case-studies/autonomous-paid-testing">Case study</Link>
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
