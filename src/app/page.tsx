import "./landing-v2.css";
import type { Metadata } from "next";
import { chainConfig } from "@/lib/deputy/networks";
import { getAgentChainSplit, getPublicReceipts } from "@/lib/erc8004/reputation";
import { ecosystemStatus } from "@/lib/ecosystem/status";
import { CinematicLanding } from "@/components/landing/cinematic-landing";

// The landing binds to live vault state + the real deduped payout journal on each
// request — the hero total, the featured receipt, the proof rail and the closing
// stats ALL derive from one server-side source (see `feed` below), so no two numbers
// on the page can disagree.
export const dynamic = "force-dynamic";

/**
 * The landing overrides the root title, so it carries its own SEO weight. Written to be QUOTED:
 * an answer engine asked "what pays people to test products" should be able to lift a sentence and
 * be right. Concrete nouns (USDC, on-chain vault, receipt) over positioning language, and no em
 * dashes, which read as machine-written and get mangled in snippets.
 */
export const metadata: Metadata = {
  // CATEGORY FIRST, BRAND LAST. Same words as before, brand moved to the end — this is the page
  // that has to win the query, and opening on the bare word meant opening against Sage Group,
  // Sage Pay/Opayo and Ask Sage. The category has no incumbent, so lead on it.
  // Still category-first, brand-last — and the WINNING category words ("tests your product",
  // "pays real testers") stay in the sentence: the broadened frame extends the query surface
  // (gigs, milestone grants, verified work) without abandoning the one category we already rank in.
  title: "AI agent that pays for verified work — product testing, gigs, milestone grants · Sage",
  description:
    "Give Sage work to fund: it tests your product and pays real testers in USDC, or pays a gig, bounty, or milestone grant when the deliverable verifies. It checks every claim itself — in a real browser, against the published artifact, or on-chain — screens every recipient against the OFAC sanctions list, and settles from an on-chain vault it cannot exceed. Every payout publishes a receipt you can verify, and every earner builds a permanent verified work record.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Sage: say the work once. It verifies, then pays.",
    description:
      "An AI agent with a budget it cannot exceed. Product tests, gigs, and milestone grants run the same loop: define, verify, pay or refuse — every payout a public on-chain receipt, every earner a verified work record.",
    type: "website",
  },
};

export default async function HomePage() {
  // The landing is the MAINNET showcase — GOAT Network, real USDC. Only real GOAT
  // payouts appear.
  const net = chainConfig(2345);

  // ── ONE coherent source of truth for every number on the page ──
  // The deduped real journal (sandbox-excluded), not the vault's raw on-chain log
  // (which carried old test spends and rendered as phantom totals). The hero, proof
  // rail, and closing stats all read THIS.
  // The RAIL is a display window (the most recent receipts). The TOTALS are the whole
  // record. Summing the window was the bug: getPublicReceipts() caps at 12, so as payouts
  // accumulated the hero total silently became "the last twelve" and drifted away from the
  // real figure — it read $34.47 against a true $48.10. A number a visitor is invited to
  // verify on-chain must come from the full journal, never from what fits on screen.
  const feed = getPublicReceipts().filter((h) => h.chainId === 2345);
  const record = getAgentChainSplit().find((c) => c.chainId === 2345);
  const totals = {
    paidUsd: record?.settledUsd ?? 0,
    payoutCount: record?.payouts ?? 0,
    blockedCount: record?.blocks ?? 0,
  };

  const ecosystem = await ecosystemStatus();

  return (
    <CinematicLanding
      network={{ name: net.name, chainId: net.chainId }}
      totals={totals}
      feed={feed}
      now={Date.now()}
      ecosystem={ecosystem}
    />
  );
}
