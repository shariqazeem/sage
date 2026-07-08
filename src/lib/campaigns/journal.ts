import type { CampaignEvent, EventKind } from "@/lib/db/schema";

/**
 * Display derivation for the work journal. Pure and type-only on the schema, so
 * it unit-tests without the DB. The journal renders exactly these entries from
 * real event rows — there is no path that invents one.
 */
export type JournalTone =
  | "settled"
  | "blocked"
  | "timelocked"
  | "neutral"
  | "action";

export interface JournalMeta {
  tone: JournalTone;
  label: string;
}

const META: Record<EventKind, JournalMeta> = {
  campaign_created: { tone: "action", label: "Campaign created" },
  submission_received: { tone: "neutral", label: "Submission received" },
  submission_approved: { tone: "action", label: "Submission approved" },
  submission_rejected: { tone: "blocked", label: "Submission rejected" },
  vendor_queued: { tone: "timelocked", label: "Recipient queued" },
  vendor_allowlisted: { tone: "timelocked", label: "Recipient allowlisted" },
  settled: { tone: "settled", label: "Payout settled" },
  blocked: { tone: "blocked", label: "Payout blocked" },
  revoked: { tone: "blocked", label: "Vault revoked" },
  decision_recorded: { tone: "neutral", label: "Deputy reviewed" },
  autopay_settled: { tone: "settled", label: "Paid by Deputy" },
  autopay_held: { tone: "timelocked", label: "Held by Deputy" },
  fee_settled: { tone: "neutral", label: "Operator fee paid" },
  fee_pending: { tone: "timelocked", label: "Operator fee pending" },
};

export function journalMeta(kind: EventKind): JournalMeta {
  return META[kind] ?? { tone: "neutral", label: kind };
}

/**
 * The journal's `detail` column carries a human string, but pipeline-authored
 * events also thread a correlation id for tracing — WITHOUT a schema change. The
 * pipeline stores a tiny JSON envelope `{"t": <text>, "cid": <id>}`; every other
 * event stores a plain string. These two helpers are the sole readers/writers of
 * that convention. `decodeDetail` is backward-compatible: a plain string (legacy
 * or non-pipeline event) round-trips as its own text with a null cid.
 */
export function encodeDetail(text: string, meta?: { cid?: string | null }): string {
  if (!meta?.cid) return text;
  return JSON.stringify({ t: text, cid: meta.cid });
}

export function decodeDetail(detail: string | null): {
  text: string | null;
  cid: string | null;
} {
  if (!detail) return { text: detail, cid: null };
  if (detail.startsWith("{")) {
    try {
      const o = JSON.parse(detail) as { t?: unknown; cid?: unknown };
      if (o && typeof o === "object" && typeof o.t === "string") {
        return { text: o.t, cid: typeof o.cid === "string" ? o.cid : null };
      }
    } catch {
      /* not our envelope — fall through to plain text */
    }
  }
  return { text: detail, cid: null };
}

export interface JournalEntry {
  id: string;
  kind: EventKind;
  tone: JournalTone;
  label: string;
  detail: string | null;
  /** correlation id of the pipeline run that authored this event, if any. */
  cid: string | null;
  /** reward in USDC base units (6dp), for settled / blocked. */
  amountBase: number | null;
  txHash: string | null;
  failedCheckIndex: number | null;
  at: number;
}

/** Map real event rows to journal entries, newest first. */
export function toJournalEntries(events: CampaignEvent[]): JournalEntry[] {
  return [...events]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((e) => {
      const meta = journalMeta(e.kind);
      const { text, cid } = decodeDetail(e.detail);
      return {
        id: e.id,
        kind: e.kind,
        tone: meta.tone,
        label: meta.label,
        detail: text,
        cid,
        amountBase: e.amount,
        txHash: e.txHash,
        failedCheckIndex: e.failedCheckIndex,
        at: e.createdAt,
      };
    });
}
