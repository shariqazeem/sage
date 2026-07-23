import "./landing-v2.css";
import type { Metadata } from "next";
import { getOperatorVaultState } from "@/lib/deputy/chain";
import { chainConfig } from "@/lib/deputy/networks";
import { getPublicReceipts } from "@/lib/erc8004/reputation";
import { ecosystemStatus } from "@/lib/ecosystem/status";
import { CinematicLanding } from "@/components/landing/cinematic-landing";

// The landing binds to live vault state + the real deduped payout journal on each
// request — the hero total, the featured receipt, the proof rail and the closing
// stats ALL derive from one server-side source (see `feed` below), so no two numbers
// on the page can disagree.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sage — an autonomous agent that tests products and pays for verified work",
  description:
    "Give Sage a product and a budget. It explores the product itself, designs paid testing missions from what it observed, independently replays verifiable actions in a fresh browser, and settles successful work on-chain — inside limits it can never exceed.",
  openGraph: {
    title: "Sage — it sees the work, it does it again, then it pays",
    description:
      "An autonomous agent with eyes, judgment, and a policy-bound wallet. It verifies real testing work by replaying it, and every payout is a public receipt.",
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
  const feed = getPublicReceipts().filter((h) => h.chainId === 2345);
  const settled = feed.filter((h) => h.settled);
  const blocked = feed.filter((h) => !h.settled);
  const totals = {
    paidUsd: settled.reduce((s, h) => s + h.amount, 0),
    payoutCount: settled.length,
    blockedCount: blocked.length,
  };

  // The policy scene uses the live per-tx cap (a genuinely different concept from the
  // paid total). No fabricated fallback — null when the read fails.
  const vault = await getOperatorVaultState("launch-growth");
  const perTxCap = vault?.perTxCap ?? null;

  const ecosystem = await ecosystemStatus();

  return (
    <CinematicLanding
      network={{ name: net.name, chainId: net.chainId }}
      totals={totals}
      feed={feed}
      perTxCap={perTxCap}
      now={Date.now()}
      ecosystem={ecosystem}
    />
  );
}
