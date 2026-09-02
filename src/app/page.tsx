import "./landing-v2.css";
import type { Metadata } from "next";
import { chainConfig } from "@/lib/deputy/networks";
import { getPublicReceipts } from "@/lib/erc8004/reputation";
import { mainnetSettled, settledLedger, decidedOnMainnet } from "@/lib/campaigns/settled-ledger";
import { loadShowcase } from "@/lib/landing/showcase";
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
  /**
   * ONE LEDGER, EVERY RAIL — the landing read GOAT alone (`chainId === 2345`) and derived
   * "refused" from on-chain rejections, so the front door said "$51.10 · 26 payouts on GOAT
   * Network · 0% refused" while the explorer, one click away, said $52.60 · 29 · 43% across two
   * rails. A privacy-hackathon judge's first screen erased the rail being judged, and the number
   * the whole capital story leans on (the refusal rate is the institutional asset) was denied by
   * the page that introduces it. The explorer fixed both derivations weeks ago; this page kept
   * its own copy. Same rows now: the settled ledger for money, the decided ledger for refusals.
   */
  const isMainnetRail = (chainId: number | null | undefined) =>
    chainId != null && chainConfig(chainId).isMainnet;
  const feed = getPublicReceipts().filter((h) => isMainnetRail(h.chainId));
  const settled = mainnetSettled();
  const decided = decidedOnMainnet(); // one derivation with the explorer, outcomes and launch pages
  const totals = {
    paidUsd: settled.usdcSettled,
    payoutCount: settled.payouts,
    refusedCount: decided.refused,
    refusalPct: decided.sharePct,
  };
  // The rails that have actually settled real money, most payouts first — "GOAT Network + Starknet".
  const railCounts = new Map<number, number>();
  for (const r of settledLedger()) if (r.mainnet) railCounts.set(r.chainId, (railCounts.get(r.chainId) ?? 0) + 1);
  const railNames = [...railCounts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => chainConfig(id).name);
  const net = { name: railNames.length > 0 ? railNames.join(" + ") : chainConfig(2345).name, chainId: 2345 };

  const ecosystem = await ecosystemStatus();
  const showcase = loadShowcase();

  return (
    <CinematicLanding
      network={{ name: net.name, chainId: net.chainId }}
      totals={totals}
      feed={feed}
      now={Date.now()}
      ecosystem={ecosystem}
      showcase={showcase}
    />
  );
}
