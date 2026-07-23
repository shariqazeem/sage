import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * P3 — the ONE runtime schema verifier for the payout-replay / VerificationPolicy system, used by BOTH the
 * deputy (payoutReplaySchemaReady) and the release CLI (scripts/canary-release-preflight.mjs mirrors this spec).
 * Verifies migrations 0026-0029: the campaign + plan-revision policy columns, the journal table + probe_version
 * column, and the journal's unique binding index. SELF_CANARY and OBSERVE must refuse when anything is absent.
 * Deterministic, read-only.
 */

/** The single source of truth for the required schema (mirrored by the CLI). */
export const REQUIRED_SCHEMA = {
  campaigns: ["verification_policy", "verification_policy_digest", "verification_policy_version", "verification_policy_required", "policy_source_revision_number"],
  plan_revisions: ["verification_policy", "verification_policy_digest", "verification_policy_required", "grounded_provenance"],
  payout_replay_journal: { columns: ["probe_version", "run_id", "submission_id", "policy_digest", "probe_digest", "completed_at"], uniqueIndex: "prj_key_unq" },
} as const;

type SchemaProbe = { all: (q: string) => unknown[] };

/** Verify the schema against a given probe (default: the global db). Exported so tests can pass a temp DB. */
export function verifyPayoutReplaySchema(probe: SchemaProbe = { all: (q) => db.all(sql.raw(q)) as unknown[] }): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  const cols = (table: string): Set<string> => {
    try { return new Set((probe.all(`PRAGMA table_info(${table})`) as { name: string }[]).map((c) => c.name)); } catch { return new Set(); }
  };
  const campaignCols = cols("campaigns");
  for (const c of REQUIRED_SCHEMA.campaigns) if (!campaignCols.has(c)) missing.push(`campaigns.${c}`);
  const revCols = cols("plan_revisions");
  for (const c of REQUIRED_SCHEMA.plan_revisions) if (!revCols.has(c)) missing.push(`plan_revisions.${c}`);
  const journalCols = cols("payout_replay_journal");
  if (journalCols.size === 0) missing.push("payout_replay_journal");
  else for (const c of REQUIRED_SCHEMA.payout_replay_journal.columns) if (!journalCols.has(c)) missing.push(`payout_replay_journal.${c}`);
  // the unique binding index must exist (idempotency + concurrency safety depend on it).
  try {
    const idx = probe.all(`SELECT name FROM sqlite_master WHERE type='index' AND name='${REQUIRED_SCHEMA.payout_replay_journal.uniqueIndex}'`) as { name: string }[];
    if (idx.length === 0) missing.push(`index:${REQUIRED_SCHEMA.payout_replay_journal.uniqueIndex}`);
  } catch { missing.push(`index:${REQUIRED_SCHEMA.payout_replay_journal.uniqueIndex}`); }
  return { ok: missing.length === 0, missing };
}

/** Deputy-facing: the runtime check against the global db. canary AND shadow refuse when this is not ok. */
export function payoutReplaySchemaReady(): { ok: boolean; missing: string[] } {
  return verifyPayoutReplaySchema();
}
