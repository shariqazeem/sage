import "server-only";

import {
  listAllDecisions,
  listEventsByKinds,
  listPaidRecipientWallets,
  listRecentDecisions,
  sumSettledFeesBase,
} from "@/lib/db/campaigns";
import { agentAddress, hasAgentKey } from "@/lib/x402/goat-pay";
import type { BriefRecommendation } from "@/lib/deputy/brain-core";
import type { EventKind } from "@/lib/db/schema";
import { getAgentIdentity, type AgentIdentity } from "./identity";
import {
  deriveReputation,
  toReceipts,
  type AgentReceipt,
  type AgentReputation,
  type RepEvent,
} from "./reputation-core";

/**
 * The server composition for the Deputy's grounded reputation — the seam that
 * reads real rows and hands them to the pure deriver (`reputation-core.ts`).
 * Thin, like `campaigns/overview.ts`: no logic lives here that isn't a DB read or
 * a shape adaptation, so the derivation stays unit-testable in isolation.
 */

/** Event kinds that constitute the payout record (settled money moved or was blocked). */
const PAYOUT_KINDS: EventKind[] = ["settled", "autopay_settled", "blocked"];

/** Read the payout journal and adapt it to the deriver's lean event shape. */
function readRepEvents(): RepEvent[] {
  return listEventsByKinds(PAYOUT_KINDS).map((e) => ({
    kind: e.kind,
    amount: e.amount,
    txHash: e.txHash,
    campaignId: e.campaignId,
    createdAt: e.createdAt,
    failedCheckIndex: e.failedCheckIndex,
  }));
}

function readDecisionStats(): { engine: string; confidence: number }[] {
  return listAllDecisions().map((d) => ({
    engine: d.engine,
    confidence: d.brief?.confidence ?? 0,
  }));
}

/** The Deputy's grounded reputation from real rows — journal + submissions + decisions. */
export function getAgentReputation(): AgentReputation {
  return deriveReputation({
    events: readRepEvents(),
    paidRecipients: listPaidRecipientWallets(),
    decisions: readDecisionStats(),
  });
}

export interface RecentDecisionSummary {
  campaignTitle: string;
  recommendation: BriefRecommendation;
  /** overall confidence, 0..1. */
  confidence: number;
  engine: string;
  /** unix seconds. */
  at: number;
}

/** Recent decision summaries for the public page — non-sensitive fields only. */
export function getRecentDecisions(limit = 10): RecentDecisionSummary[] {
  return listRecentDecisions(limit).map((d) => ({
    campaignTitle: d.campaignTitle,
    recommendation: d.brief.recommendation,
    confidence: d.brief.confidence,
    engine: d.engine,
    at: d.createdAt,
  }));
}

/** Everything the public agent page needs, reading the payout journal only once. */
export interface AgentProfile {
  reputation: AgentReputation;
  receipts: AgentReceipt[];
  recentDecisions: RecentDecisionSummary[];
}

export function getAgentProfile(
  receiptLimit = 10,
  decisionLimit = 10,
): AgentProfile {
  const events = readRepEvents();
  return {
    reputation: deriveReputation({
      events,
      paidRecipients: listPaidRecipientWallets(),
      decisions: readDecisionStats(),
    }),
    receipts: toReceipts(events, receiptLimit),
    recentDecisions: getRecentDecisions(decisionLimit),
  };
}

/**
 * The Deputy's on-chain P&L, summed from real rows (sandbox excluded via
 * listAllDecisions). Every number is honest; zeros render as zeros.
 *   EARNED — operator fees actually collected (RAIL 2, status 'settled').
 *   SPENT  — x402 paid verifications (RAIL 1, 0.1 USDC each) + LLM decision cost.
 */
export interface AgentPnL {
  earnedFeesUsd: number;
  verificationCount: number;
  verificationSpentUsd: number;
  llmDecisions: number;
  llmSpentUsd: number;
}

export function getAgentPnL(): AgentPnL {
  const decisions = listAllDecisions();
  const verificationCount = decisions.filter((d) => !!d.x402PaymentTx).length;
  const llmDecisions = decisions.filter((d) => d.costUsd != null).length;
  const llmSpentUsd = decisions.reduce((s, d) => s + (d.costUsd ?? 0), 0);
  return {
    earnedFeesUsd: sumSettledFeesBase() / 1_000_000,
    verificationCount,
    verificationSpentUsd: verificationCount * 0.1,
    llmDecisions,
    llmSpentUsd,
  };
}

/**
 * The agent's primary wallet: the ERC-8004 identity address once registered,
 * else the derived GOAT agent wallet (the x402 payer — the very key the register
 * script mints the identity from), else null. Only the public address is ever
 * exposed; the private key never leaves the server.
 */
export function agentWallet(
  identity: AgentIdentity = getAgentIdentity(),
): string | null {
  if (identity.address) return identity.address;
  try {
    return hasAgentKey() ? agentAddress() : null;
  } catch {
    return null;
  }
}
