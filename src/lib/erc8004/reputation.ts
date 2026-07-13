import "server-only";

import {
  listAllDecisions,
  listCampaigns,
  listEventsByKinds,
  listPaidRecipientWallets,
  listRecentDecisions,
  sumSettledFeesBase,
  walletsByPayoutTx,
} from "@/lib/db/campaigns";
import { chainConfig, explorerTxUrl, DEFAULT_CHAIN_ID } from "@/lib/deputy/networks";
import type { PayoutReceipt } from "@/lib/deputy/chain";
import { agentAddress, hasAgentKey } from "@/lib/x402/goat-pay";
import type { BriefRecommendation } from "@/lib/deputy/brain-core";
import type { EventKind } from "@/lib/db/schema";
import { getAgentIdentity, type AgentIdentity } from "./identity";
import {
  aggregateByChain,
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

/** Read the payout journal and adapt it to the deriver's lean event shape.
 *  Each event is tagged with its campaign's chainId so the dedup key is
 *  chainId+tx and a per-chain split is possible (testnet ≠ mainnet). */
function readRepEvents(): RepEvent[] {
  const chainById = new Map(listCampaigns().map((c) => [c.id, c.chainId]));
  return listEventsByKinds(PAYOUT_KINDS).map((e) => ({
    kind: e.kind,
    amount: e.amount,
    txHash: e.txHash,
    campaignId: e.campaignId,
    chainId: chainById.get(e.campaignId) ?? null,
    createdAt: e.createdAt,
    failedCheckIndex: e.failedCheckIndex,
  }));
}

const SETTLED: ReadonlySet<EventKind> = new Set<EventKind>(["settled", "autopay_settled"]);
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = `0x${"0".repeat(64)}`;

/**
 * The public payout feed for the landing — the SAME clean, deduped record the agent card uses
 * (real journal events, sandbox-excluded, one receipt per chainId+tx), NOT a single vault's raw
 * on-chain log (which can carry old, unrelated test spends). Each receipt is proof-linkable and
 * carries a real recipient + amount. Newest first, capped at `limit`.
 */
export function getPublicReceipts(limit = 12): PayoutReceipt[] {
  const walletByTx = walletsByPayoutTx();
  const seen = new Set<string>();
  const out: PayoutReceipt[] = [];
  const events = readRepEvents()
    .filter((e) => e.txHash && (SETTLED.has(e.kind) || e.kind === "blocked"))
    .sort((a, b) => b.createdAt - a.createdAt);
  for (const e of events) {
    const tx = e.txHash as string;
    const key = e.chainId != null ? `${e.chainId}:${tx}` : tx;
    if (seen.has(key)) continue;
    seen.add(key);
    const settled = SETTLED.has(e.kind);
    const chainId = e.chainId ?? DEFAULT_CHAIN_ID;
    out.push({
      txHash: tx as PayoutReceipt["txHash"],
      settled,
      recipient: (walletByTx.get(tx.toLowerCase()) ?? ZERO_ADDR) as PayoutReceipt["recipient"],
      amount: (e.amount ?? 0) / 1e6,
      timestamp: e.createdAt,
      failedCheckIndex: settled ? null : (e.failedCheckIndex ?? 0),
      intentHash: ZERO_HASH as PayoutReceipt["intentHash"],
      chainId,
      explorerUrl: explorerTxUrl(chainId, tx),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** One chain's slice of the settled record — never mixes testnet with mainnet. */
export interface ChainRecord {
  chainId: number;
  network: string;
  isMainnet: boolean;
  settledUsd: number;
  payouts: number;
  blocks: number;
}

/**
 * The agent's record split BY CHAIN — so a combined total can be shown as
 * explicitly combined, and a GOAT-mainnet figure never silently includes Metis
 * Sepolia test USDC. Deduped by chainId+tx. Rows with an unknown chain are
 * dropped from the split (they still count in the combined total).
 */
export function getAgentChainSplit(): ChainRecord[] {
  return [...aggregateByChain(readRepEvents()).entries()]
    .map(([chainId, v]) => {
      const cfg = chainConfig(chainId);
      return {
        chainId,
        network: cfg.name,
        isMainnet: cfg.isMainnet,
        settledUsd: v.settledBase / 1_000_000,
        payouts: v.payouts,
        blocks: v.blocks,
      };
    })
    .sort((a, b) => Number(b.isMainnet) - Number(a.isMainnet) || b.settledUsd - a.settledUsd);
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
  /** the record split by chain — so the combined total is shown as combined. */
  chainSplit: ChainRecord[];
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
    chainSplit: getAgentChainSplit(),
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
