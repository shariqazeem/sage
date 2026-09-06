import Link from "next/link";
import type { PayoutReceipt } from "@/lib/deputy/chain";
import type { EcosystemStatus } from "@/lib/ecosystem/status";
import type { Showcase, ShowcaseMove } from "@/lib/landing/showcase";
import { EcosystemStrip } from "@/components/ecosystem/ecosystem-strip";
import { SageMark } from "@/components/brand/sage-mark";
import { geist } from "./fonts";
import { LandingNav } from "./landing-nav";
import { SceneHero } from "./scene-hero";
import { SceneWorkflow } from "./scene-workflow";
import { SceneProof } from "./scene-proof";
import { SceneCapital } from "./scene-capital";
import { SceneClose } from "./scene-close";
import { SceneRoadmap } from "./scene-roadmap";

interface Props {
  network: { name: string; chainId: number };
  totals: { paidUsd: number; payoutCount: number; refusedCount: number; refusalPct: number };
  feed: PayoutReceipt[];
  now: number;
  ecosystem: EcosystemStatus;
  showcase: Showcase | null;
  move?: ShowcaseMove | null;
}

/**
 * Sage landing V2 — TARGETED (FC Phase 2): one arc, five scenes — what it is (Hero) → how it
 * works (Workflow) → one loop for any work, with real receipts (Loop) → live proof (Proof) →
 * close. The Partners strip lives in the footer's ecosystem strip; the interactive Replay demo
 * and the Policy panel were cut deliberately — their one-line essence lives in the hero, the Loop
 * panel, and /docs/compliance. Showing everything is what an app does; infrastructure shows the
 * primitive and the receipts. Server Component; numbers all derive from ONE source (`feed`).
 */
export function CinematicLanding({ network, totals, feed, now, ecosystem, showcase, move = null }: Props) {
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
        <SceneWorkflow showcase={showcase} move={move} />

        <SceneProof feed={feed} totals={totals} networkName={network.name} now={now} />
        {/* What the payouts BECOME — the credit file and the advance. Written weeks ago, unmounted
            until 5 Sep: the front door said nothing in the finance track's language. After Proof
            on purpose: a file you can lend against is a claim nobody should accept before the
            receipts it is built from. */}
        <SceneCapital totals={totals} />
        {/* THE ROADMAP (6 Sep): the vision in the finance track's language — live, this week, and
            the partner-gated horizon with the how on every item. After Capital, because a plan is
            only credible after the record it builds on. */}
        <SceneRoadmap />

        <SceneClose totals={totals} networkName={network.name} />
      </main>

      <footer className="foot">
        <div className="wrap foot-in">
          <div className="foot-brand">
            <Link href="/" className="nav-brand" aria-label="Sage home">
              <SageMark size={18} />
              <span>Sage</span>
            </Link>
            <p className="foot-tag">An agent with eyes, judgment, and a wallet. It verifies the work itself and pays inside limits it cannot exceed.</p>
            <span className="foot-net mono"><i aria-hidden /> Live on {network.name}</span>
          </div>
          <nav className="foot-col" aria-label="Product">
            <h4>Product</h4>
            <a href="#how">How Sage works</a>
            <Link href="/marketplace">Find work</Link>
            <Link href="/verify">Get verified</Link>
            <Link href="/start">Put Sage to work</Link>
            <Link href="/dashboard">Dashboard</Link>
          </nav>
          <nav className="foot-col" aria-label="Proof">
            <h4>Proof</h4>
            <Link href="/explorer">Explorer</Link>
            <Link href="/outcomes">Outcomes</Link>
            <Link href="/case-studies/autonomous-paid-testing">Case study</Link>
            <Link href="/agents/sage">Agent record</Link>
          </nav>
          <nav className="foot-col" aria-label="Read">
            <h4>Read</h4>
            <Link href="/docs">Docs</Link>
            <Link href="/docs/operator">The operator</Link>
            <Link href="/docs/privacy">Private on Starknet</Link>
            <Link href="/lender">For lenders</Link>
            <Link href="/docs/compliance">Compliance</Link>
          </nav>
        </div>
        <div className="wrap foot-eco">
          <EcosystemStrip status={ecosystem} />
          <span className="foot-fine mono">sagepays.xyz · every number on this page is read from the ledger</span>
        </div>
      </footer>
    </div>
  );
}
