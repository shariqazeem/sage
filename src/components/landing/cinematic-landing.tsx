import Link from "next/link";
import type { PayoutReceipt } from "@/lib/deputy/chain";
import type { EcosystemStatus } from "@/lib/ecosystem/status";
import type { Showcase } from "@/lib/landing/showcase";
import { EcosystemStrip } from "@/components/ecosystem/ecosystem-strip";
import { SageMark } from "@/components/brand/sage-mark";
import { geist } from "./fonts";
import { LandingNav } from "./landing-nav";
import { SceneHero } from "./scene-hero";
import { SceneWorkflow } from "./scene-workflow";
import { SceneProof } from "./scene-proof";
import { SceneClose } from "./scene-close";

interface Props {
  network: { name: string; chainId: number };
  totals: { paidUsd: number; payoutCount: number; refusedCount: number; refusalPct: number };
  feed: PayoutReceipt[];
  now: number;
  ecosystem: EcosystemStatus;
  showcase: Showcase | null;
}

/**
 * Sage landing V2 — TARGETED (FC Phase 2): one arc, five scenes — what it is (Hero) → how it
 * works (Workflow) → one loop for any work, with real receipts (Loop) → live proof (Proof) →
 * close. The Partners strip lives in the footer's ecosystem strip; the interactive Replay demo
 * and the Policy panel were cut deliberately — their one-line essence lives in the hero, the Loop
 * panel, and /docs/compliance. Showing everything is what an app does; infrastructure shows the
 * primitive and the receipts. Server Component; numbers all derive from ONE source (`feed`).
 */
export function CinematicLanding({ network, totals, feed, now, ecosystem, showcase }: Props) {
  return (
    <div className={`slv2 ${geist.variable}`}>
      <LandingNav />

      <main>
        <SceneHero
          paidUsd={totals.paidUsd}
          payoutCount={totals.payoutCount}
          refusedCount={totals.refusedCount}
          networkName={network.name}
          feed={feed}
          now={now}
        />

        {/* SAGE FOR TEAMS (2026-09-04): the landing says one thing four times — what it is, how it
            runs, that it is real, and where to start. Trust, loop, teams, privacy and capital are
            documented, not paraded: a new team read nine scenes and opened none of the doors. */}
        <SceneWorkflow showcase={showcase} />

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
