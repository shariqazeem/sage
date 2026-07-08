import { NextResponse } from "next/server";
import { getAgentIdentity } from "@/lib/erc8004/identity";
import { agentWallet, getAgentReputation } from "@/lib/erc8004/reputation";
import { agentPageUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Sage's Payout Deputy — an autonomous ERC-8004 agent that releases USDC from a policy-capped on-chain vault. Give it a budget, not your keys. Every payout is verifiable and graded on-chain.";

/**
 * GET /api/agent/card — the canonical machine-readable agent URI. Matches the
 * onboarding guide's agent-URI shape `{ name, description, url, wallet }`,
 * extended with `{ agentId?, chainId, registry, registered, stats }` so a reader
 * gets the identity AND the grounded reputation in one document. Every stat is
 * derived from real rows; nothing is asserted. Cached 60s at the edge.
 */
export function GET() {
  const id = getAgentIdentity();
  const r = getAgentReputation();

  const body = {
    name: id.name ?? "Sage",
    description: DESCRIPTION,
    url: agentPageUrl(),
    wallet: agentWallet(id),
    ...(id.agentId ? { agentId: id.agentId } : {}),
    chainId: id.chainId,
    registry: id.registry,
    registered: id.registered,
    stats: {
      settledUsd: r.settledTotalBase / 1e6,
      settledBase: r.settledTotalBase,
      payouts: r.payoutCount,
      blocked: r.blockedCount,
      recipients: r.distinctRecipients,
      campaigns: r.distinctCampaigns,
      decisions: r.decisionCount,
      avgConfidence: r.avgConfidence,
      engineMix: r.engineMix,
      firstActivityAt: r.firstActivityAt,
      lastActivityAt: r.lastActivityAt,
    },
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=120",
    },
  });
}
