import "./agents.css";
// the jailbreak box renders a real Deputy receipt — pull in its shared styles.
import "../../app/app.css";
import "../../app/demo-moments.css";
import type { Metadata } from "next";
import { getAgentIdentity } from "@/lib/erc8004/identity";
import {
  agentWallet,
  getAgentPnL,
  getAgentProfile,
  getAgentReputation,
} from "@/lib/erc8004/reputation";
import { AgentProfilePage } from "@/components/agents/agent-profile-page";
import { agentPageUrl, siteUrl } from "@/lib/site";
import { usd } from "@/lib/format";
import { attackLedger, DEFENSE_LABEL } from "@/lib/redteam/catalog";
import { ensureSandboxCampaign } from "@/lib/db/campaigns";

// Reputation reads the live DB on each request — the page IS the track record.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const id = getAgentIdentity();
  const r = getAgentReputation();
  const name = id.name ?? "Sage";
  const title = `${name} — Autonomous Payout Deputy`;
  const description = r.active
    ? `${usd(r.settledTotalBase / 1e6)} settled across ${r.payoutCount} on-chain payout${
        r.payoutCount === 1 ? "" : "s"
      } to ${r.distinctRecipients} recipient${r.distinctRecipients === 1 ? "" : "s"}, ${
        r.blockedCount
      } blocked by policy. ERC-8004 identity on ${id.network} — every payout verifiable and graded.`
    : `Sage's Payout Deputy — an ERC-8004 agent that releases USDC from a policy-capped on-chain vault. Give it a budget, not your keys. Every payout is verifiable and graded on-chain.`;

  return {
    metadataBase: new URL(siteUrl()),
    title,
    description,
    alternates: { canonical: "/agents/sage" },
    openGraph: {
      title,
      description,
      url: agentPageUrl(),
      siteName: "Sage",
      type: "profile",
    },
    twitter: { card: "summary", title, description },
  };
}

export default function AgentPage() {
  const identity = getAgentIdentity();
  const { reputation, receipts, recentDecisions, chainSplit } = getAgentProfile();
  ensureSandboxCampaign(); // the "try to jailbreak" box runs against this sandbox
  const led = attackLedger();

  return (
    <AgentProfilePage
      identity={identity}
      wallet={agentWallet(identity)}
      reputation={reputation}
      chainSplit={chainSplit}
      receipts={receipts}
      recentDecisions={recentDecisions}
      ledger={{
        count: led.attackCount,
        rows: led.rows.map((a) => ({ klass: a.klass, defense: DEFENSE_LABEL[a.defense] })),
      }}
      pnl={getAgentPnL()}
    />
  );
}
