/**
 * The Deputy's GROUNDED reputation — derived, never asserted. Pure and type-only
 * on the schema (exactly like `campaigns/journal.ts`), so it unit-tests without a
 * DB and the server layer (`reputation.ts`) composes it over real rows.
 *
 * The reputation an ERC-8004 identity points at is a work record built from data
 * we already have: real settled payouts, real blocks (the integrity signal — the
 * leash actually stops bad spends), and the Deputy's decision receipts. Zeros
 * render honestly: an agent that hasn't worked yet has an empty, truthful record,
 * not a flattering one.
 */

import type { EventKind } from "@/lib/db/schema";

/** Event kinds that represent a real, on-chain settled payout. */
const SETTLED_KINDS: ReadonlySet<EventKind> = new Set<EventKind>([
  "settled",
  "autopay_settled",
]);

/** The lean event shape the deriver needs — a subset of a real event row. */
export interface RepEvent {
  kind: EventKind;
  /** reward in USDC base units (6dp), for settled / blocked. */
  amount: number | null;
  txHash: string | null;
  campaignId: string;
  /** the chain this payout settled on — part of a receipt's on-chain identity. */
  chainId?: number | null;
  /** unix seconds. */
  createdAt: number;
  /** SpendRejected.failedCheckIndex (1..7) for blocked, else null. */
  failedCheckIndex?: number | null;
}

/**
 * A payout's on-chain identity: `chainId:txHash`. One real settlement can emit
 * several journal rows (settle-flow's `settled` PLUS the pipeline's
 * `autopay_settled`, or a chain reconciliation) — they share this key, so it
 * dedupes a single payout to a single count and a single receipt. A tx hash is
 * already globally unique (EIP-155 binds the chainId into the signature), so
 * txHash alone is a sound fallback when the chain is unknown.
 */
function receiptKey(e: { chainId?: number | null; txHash: string | null }): string {
  const tx = e.txHash ?? "";
  return e.chainId != null ? `${e.chainId}:${tx}` : tx;
}

/** The lean decision shape the deriver needs. */
export interface RepDecision {
  /** 'llm' | 'heuristic'. */
  engine: string;
  /** overall confidence in the recommendation, 0..1. */
  confidence: number;
}

export interface ReputationInput {
  /** settled / autopay_settled / blocked events across all campaigns. */
  events: RepEvent[];
  /** recipient wallets of paid submissions (deriver lowercases + dedupes). */
  paidRecipients: string[];
  /** every stored decision receipt (engine + confidence). */
  decisions: RepDecision[];
}

/** The grounded reputation. Every number traces to a real row; zeros are honest. */
export interface AgentReputation {
  /** total real USDC released, in base units (6dp). */
  settledTotalBase: number;
  /** number of settled payouts. */
  payoutCount: number;
  /** number of blocked spends — the integrity signal (the vault held). */
  blockedCount: number;
  /** distinct campaigns the Deputy did payout work for. */
  distinctCampaigns: number;
  /** distinct recipient wallets actually paid. */
  distinctRecipients: number;
  /** unix seconds of the earliest / latest payout activity (null if none). */
  firstActivityAt: number | null;
  lastActivityAt: number | null;
  /** stored decision receipts. */
  decisionCount: number;
  /** mean recommendation confidence across decisions (0..1), null if none. */
  avgConfidence: number | null;
  /** engine split of the decision receipts. */
  engineMix: { llm: number; heuristic: number };
  /** whether the agent has ANY real record yet (drives the honest empty state). */
  active: boolean;
}

/** The empty, truthful record — an agent that has not worked yet. */
export const EMPTY_REPUTATION: AgentReputation = {
  settledTotalBase: 0,
  payoutCount: 0,
  blockedCount: 0,
  distinctCampaigns: 0,
  distinctRecipients: 0,
  firstActivityAt: null,
  lastActivityAt: null,
  decisionCount: 0,
  avgConfidence: null,
  engineMix: { llm: 0, heuristic: 0 },
  active: false,
};

/**
 * Derive the reputation from real rows. Settled totals + counts come from the
 * journal events (chain-reconciled amounts), distinct recipients from paid
 * submissions, and the decision stats from the receipts. No input can inflate the
 * record — an amount is counted only on a settled event, a block only on a
 * blocked event.
 */
export function deriveReputation(input: ReputationInput): AgentReputation {
  let settledTotalBase = 0;
  let payoutCount = 0;
  let blockedCount = 0;
  let firstActivityAt: number | null = null;
  let lastActivityAt: number | null = null;
  const campaigns = new Set<string>();
  // One on-chain payout/block can emit several journal rows (settle-flow's
  // `settled` PLUS the pipeline's `autopay_settled` for an autopilot payout, or
  // chain reconciliation). Dedupe by chainId+tx so a single on-chain event is
  // counted — and valued — exactly once; the record must never inflate itself.
  const seenSettleTx = new Set<string>();
  const seenBlockTx = new Set<string>();

  for (const e of input.events) {
    const isSettled = SETTLED_KINDS.has(e.kind);
    const isBlocked = e.kind === "blocked";
    if (!isSettled && !isBlocked) continue;

    if (isSettled) {
      if (e.txHash) {
        const key = receiptKey(e);
        if (seenSettleTx.has(key)) continue;
        seenSettleTx.add(key);
      }
      payoutCount += 1;
      settledTotalBase += e.amount ?? 0;
    } else {
      if (e.txHash) {
        const key = receiptKey(e);
        if (seenBlockTx.has(key)) continue;
        seenBlockTx.add(key);
      }
      blockedCount += 1;
    }
    if (e.campaignId) campaigns.add(e.campaignId);
    if (firstActivityAt === null || e.createdAt < firstActivityAt) {
      firstActivityAt = e.createdAt;
    }
    if (lastActivityAt === null || e.createdAt > lastActivityAt) {
      lastActivityAt = e.createdAt;
    }
  }

  const recipients = new Set<string>();
  for (const w of input.paidRecipients) {
    if (w) recipients.add(w.toLowerCase());
  }

  let llm = 0;
  let heuristic = 0;
  let confidenceSum = 0;
  for (const d of input.decisions) {
    if (d.engine === "llm") llm += 1;
    else if (d.engine === "heuristic") heuristic += 1;
    confidenceSum += Number.isFinite(d.confidence) ? d.confidence : 0;
  }
  const decisionCount = input.decisions.length;
  const avgConfidence =
    decisionCount > 0
      ? Math.round((confidenceSum / decisionCount) * 1000) / 1000
      : null;

  return {
    settledTotalBase,
    payoutCount,
    blockedCount,
    distinctCampaigns: campaigns.size,
    distinctRecipients: recipients.size,
    firstActivityAt,
    lastActivityAt,
    decisionCount,
    avgConfidence,
    engineMix: { llm, heuristic },
    active: payoutCount > 0 || blockedCount > 0 || decisionCount > 0,
  };
}

/** One chain's aggregated slice, deduped by tx within that chain. */
export interface ChainAgg {
  settledBase: number;
  payouts: number;
  blocks: number;
}

/**
 * Aggregate the record BY chain — so a combined total can be shown as combined
 * and a mainnet figure never silently includes testnet. Events with an unknown
 * chain or no tx are excluded from the split (they still count in the combined
 * total via {@link deriveReputation}). Deduped by tx within each chain. Pure.
 */
export function aggregateByChain(events: RepEvent[]): Map<number, ChainAgg> {
  const acc = new Map<number, ChainAgg & { seen: Set<string> }>();
  for (const e of events) {
    if (e.chainId == null || !e.txHash) continue;
    const settled = SETTLED_KINDS.has(e.kind);
    const blocked = e.kind === "blocked";
    if (!settled && !blocked) continue;
    const slot =
      acc.get(e.chainId) ?? { settledBase: 0, payouts: 0, blocks: 0, seen: new Set<string>() };
    if (!slot.seen.has(e.txHash)) {
      slot.seen.add(e.txHash);
      if (settled) {
        slot.payouts += 1;
        slot.settledBase += e.amount ?? 0;
      } else {
        slot.blocks += 1;
      }
    }
    acc.set(e.chainId, slot);
  }
  const out = new Map<number, ChainAgg>();
  for (const [chainId, v] of acc) {
    out.set(chainId, { settledBase: v.settledBase, payouts: v.payouts, blocks: v.blocks });
  }
  return out;
}

/** A public receipt for the agent page — a real settled/blocked tx, proof-linkable. */
export interface AgentReceipt {
  settled: boolean;
  /** reward in USDC base units (6dp). */
  amountBase: number;
  txHash: string;
  campaignId: string;
  /** unix seconds. */
  at: number;
  failedCheckIndex: number | null;
}

/**
 * Map real events to public receipts — only those carrying a tx hash (so every
 * receipt links to a verifiable `/proof/<tx>`), newest first, capped at `limit`.
 * Deduped by chainId+tx so a payout that emitted both `settled` and
 * `autopay_settled` is ONE receipt, not two — the public list never shows the
 * same on-chain payment twice.
 */
export function toReceipts(events: RepEvent[], limit = 10): AgentReceipt[] {
  const seen = new Set<string>();
  return events
    .filter((e) => e.txHash && (SETTLED_KINDS.has(e.kind) || e.kind === "blocked"))
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((e) => {
      const key = receiptKey(e);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((e) => ({
      settled: SETTLED_KINDS.has(e.kind),
      amountBase: e.amount ?? 0,
      txHash: e.txHash as string,
      campaignId: e.campaignId,
      at: e.createdAt,
      failedCheckIndex: e.failedCheckIndex ?? null,
    }));
}
