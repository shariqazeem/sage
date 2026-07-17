import type { CampaignEvent } from "@/lib/db/schema";
import { CHECK_NAMES } from "@/lib/deputy/reasons";

/**
 * The public "Sage activity" feed — a projection of REAL campaign rows into safe,
 * spectator-grade event lines. Pure and type-only on the schema, so it unit-tests
 * without a DB (mirrors journal.ts). There is no path that invents an event.
 *
 * SAFETY (load-bearing, do not weaken): this NEVER reads a submitter note, evidence
 * body, or an event's free-text `detail`. Held/blocked lines carry only a coarse CLASS
 * (a vault check name, or "manual review") — never the model's reason text. The only
 * submitter-identifying value emitted is the recipient wallet on a PAID line, which is
 * already public on-chain via the settlement tx. Pending work stays anonymous.
 */
export type ActivityKind = "received" | "verified" | "paid" | "held" | "blocked";

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  /** unix seconds. */
  at: number;
  /** reward in USDC base units (6dp) — PAID only. */
  amountBase: number | null;
  /** recipient (already public on-chain) — PAID only. */
  wallet: string | null;
  /** settlement tx → /proof/<tx> — PAID only. */
  txHash: string | null;
  /** 0..100 — VERIFIED only. */
  confidencePct: number | null;
  /** a SAFE class label — HELD/BLOCKED only. Never evidence/note/reason text. */
  reasonClass: string | null;
}

export interface ActivitySource {
  /** for "received" lines + paid-recipient lookup. */
  submissions: { id: string; wallet: string; createdAt: number }[];
  /** the real work journal. */
  events: CampaignEvent[];
  /** submissionId → overall decision confidence (0..1). Optional; missing → no % shown. */
  confidence?: Record<string, number>;
}

const clampPct = (n: number): number =>
  Math.max(0, Math.min(100, Math.round(n * 100)));

/** Project real rows into the safe activity feed, newest-first, capped at `limit`. */
export function projectActivity(src: ActivitySource, limit = 12): ActivityEvent[] {
  const walletOf = new Map(src.submissions.map((s) => [s.id, s.wallet]));
  const conf = src.confidence ?? {};
  const out: ActivityEvent[] = [];

  // received — derived from submissions (submission_received isn't journaled).
  // Anonymous on purpose: a spectator sees that work arrived, not whose pending work.
  for (const s of src.submissions) {
    out.push({
      id: `received:${s.id}`,
      kind: "received",
      at: s.createdAt,
      amountBase: null,
      wallet: null,
      txHash: null,
      confidencePct: null,
      reasonClass: null,
    });
  }

  // verified / paid / held / blocked — from the real event journal, STRUCTURED fields only.
  const seenPaidTx = new Set<string>();
  for (const e of src.events) {
    const sid = e.submissionId;
    switch (e.kind) {
      case "decision_recorded": {
        const c = sid != null ? conf[sid] : undefined;
        out.push({
          id: `verified:${e.id}`,
          kind: "verified",
          at: e.createdAt,
          amountBase: null,
          wallet: null,
          txHash: null,
          confidencePct: typeof c === "number" ? clampPct(c) : null,
          reasonClass: null,
        });
        break;
      }
      case "settled":
      case "autopay_settled": {
        // one payout can surface as both an app event and a chain-reconciled row —
        // dedupe by settlement tx so a payout appears once.
        if (e.txHash && seenPaidTx.has(e.txHash)) break;
        if (e.txHash) seenPaidTx.add(e.txHash);
        out.push({
          id: `paid:${e.id}`,
          kind: "paid",
          at: e.createdAt,
          amountBase: e.amount ?? null,
          wallet: (sid != null ? walletOf.get(sid) : null) ?? null,
          txHash: e.txHash ?? null,
          confidencePct: null,
          reasonClass: null,
        });
        break;
      }
      case "autopay_held":
        out.push({
          id: `held:${e.id}`,
          kind: "held",
          at: e.createdAt,
          amountBase: null,
          wallet: null,
          txHash: null,
          confidencePct: null,
          // coarse class ONLY — never the model's free-text hold reason.
          reasonClass: "manual review",
        });
        break;
      case "blocked":
        out.push({
          id: `blocked:${e.id}`,
          kind: "blocked",
          at: e.createdAt,
          amountBase: null,
          wallet: null,
          txHash: null,
          confidencePct: null,
          // the vault check that failed — a safe, enumerated integrity class.
          reasonClass:
            e.failedCheckIndex != null
              ? (CHECK_NAMES[e.failedCheckIndex] ?? "integrity check")
              : "integrity check",
        });
        break;
      default:
        break; // campaign_created / vendor_* / fee_* / revoked — not spectator activity
    }
  }

  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}
