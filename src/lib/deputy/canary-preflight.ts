import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Phase 2 — release preflight for payout action replay. `PAYOUT_ACTION_REPLAY_MODE=canary` REQUIRES the
 * migration-0026 campaign policy columns and the migration-0027 journal table. If they are missing, the deputy
 * must refuse canary mode BEFORE processing a submission — never after a PAY decision. Deterministic; read-only.
 */
export function payoutReplaySchemaReady(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  try {
    const cols = db.all(sql`PRAGMA table_info(campaigns)`) as { name: string }[];
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("verification_policy")) missing.push("campaigns.verification_policy");
    if (!names.has("verification_policy_digest")) missing.push("campaigns.verification_policy_digest");
  } catch {
    missing.push("campaigns");
  }
  try {
    const t = db.all(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='payout_replay_journal'`) as { name: string }[];
    if (t.length === 0) missing.push("payout_replay_journal");
  } catch {
    missing.push("payout_replay_journal");
  }
  return { ok: missing.length === 0, missing };
}
