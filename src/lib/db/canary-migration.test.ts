import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 2 — MIGRATION PROOF for 0026 (campaign policy columns) + 0027 (payout_replay_journal). Applies the raw
 * migration SQL to a fresh in-memory DB at (a) the PREVIOUS schema (0000–0025) and (b) clean (all), proving the
 * columns/table are absent before and present+usable after — and that the preflight readiness check flips.
 */

const DRIZZLE = path.resolve("drizzle");
const files = fs.readdirSync(DRIZZLE).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const applyUpTo = (db: Database.Database, upToPrefix: string) => {
  for (const f of files) {
    if (f.slice(0, 4) > upToPrefix) break;
    const sql = fs.readFileSync(path.join(DRIZZLE, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) { const s = stmt.trim(); if (s) db.exec(s); }
  }
};
// mirror payoutReplaySchemaReady against an arbitrary db.
function schemaReady(db: Database.Database) {
  const missing: string[] = [];
  const cols = new Set((db.pragma("table_info(campaigns)") as { name: string }[]).map((c) => c.name));
  if (!cols.has("verification_policy")) missing.push("campaigns.verification_policy");
  if (!cols.has("verification_policy_digest")) missing.push("campaigns.verification_policy_digest");
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payout_replay_journal'").all();
  if (t.length === 0) missing.push("payout_replay_journal");
  return { ok: missing.length === 0, missing };
}

describe("migrations 0026/0027 — previous schema → upgrade", () => {
  it("PREVIOUS schema (0000–0025): policy columns + journal table are ABSENT → preflight NOT ready", () => {
    const db = new Database(":memory:");
    applyUpTo(db, "0025");
    const r = schemaReady(db);
    expect(r.ok).toBe(false);
    expect(r.missing.sort()).toEqual(["campaigns.verification_policy", "campaigns.verification_policy_digest", "payout_replay_journal"].sort());
    db.close();
  });

  it("CLEAN install (all migrations): columns + table PRESENT + usable → preflight ready", () => {
    const db = new Database(":memory:");
    applyUpTo(db, "9999");
    expect(schemaReady(db).ok).toBe(true);
    // the journal round-trips on the unique key.
    db.prepare("INSERT INTO payout_replay_journal (id, submission_id, policy_digest, probe_digest, started_at, attempt) VALUES (?,?,?,?,?,1)").run("j1", "sub", "pol", "prb", 1);
    db.prepare("UPDATE payout_replay_journal SET decision='allow', outcome_code='reproduced', completed_at=2, latency_ms=10 WHERE id='j1'").run();
    const row = db.prepare("SELECT decision, outcome_code, completed_at FROM payout_replay_journal WHERE submission_id='sub' AND policy_digest='pol' AND probe_digest='prb'").get() as { decision: string; outcome_code: string; completed_at: number };
    expect(row).toMatchObject({ decision: "allow", outcome_code: "reproduced", completed_at: 2 });
    // the unique index forbids a duplicate key.
    expect(() => db.prepare("INSERT INTO payout_replay_journal (id, submission_id, policy_digest, probe_digest, started_at, attempt) VALUES (?,?,?,?,?,1)").run("j2", "sub", "pol", "prb", 3)).toThrow();
    db.close();
  });

  it("UPGRADE (0025 → apply 0026-0029): all policy/journal/revision columns appear + accept data", () => {
    const db = new Database(":memory:");
    applyUpTo(db, "0025");
    expect(schemaReady(db).ok).toBe(false);
    for (const f of ["0026", "0027", "0028", "0029", "0030"]) {
      const file = files.find((x) => x.startsWith(f))!;
      for (const stmt of fs.readFileSync(path.join(DRIZZLE, file), "utf8").split("--> statement-breakpoint")) { const s = stmt.trim(); if (s) db.exec(s); }
    }
    expect(schemaReady(db).ok).toBe(true);
    // 0028 plan_revisions policy binding columns.
    const revCols = new Set((db.pragma("table_info(plan_revisions)") as { name: string }[]).map((c) => c.name));
    for (const c of ["verification_policy", "verification_policy_digest", "verification_policy_required", "grounded_provenance"]) expect(revCols.has(c)).toBe(true);
    // 0029 campaigns attach columns.
    const camCols = new Set((db.pragma("table_info(campaigns)") as { name: string }[]).map((c) => c.name));
    for (const c of ["verification_policy_version", "verification_policy_required", "policy_source_revision_number"]) expect(camCols.has(c)).toBe(true);
    db.close();
  });

  it("journal begin is CONCURRENCY-SAFE: INSERT … ON CONFLICT keeps one row + bumps attempt", () => {
    const db = new Database(":memory:");
    applyUpTo(db, "9999");
    const upsert = (attempt = 1) => db.prepare(
      "INSERT INTO payout_replay_journal (id, submission_id, policy_digest, probe_digest, started_at, attempt, probe_version) VALUES (?,?,?,?,?,?,?) " +
      "ON CONFLICT(submission_id, policy_digest, probe_digest) DO UPDATE SET started_at=excluded.started_at, completed_at=NULL, attempt=attempt+1",
    ).run("id" + attempt, "sub", "pol", "prb", attempt, 1, "v");
    upsert(1); upsert(2); upsert(3);
    const rows = db.prepare("SELECT attempt FROM payout_replay_journal WHERE submission_id='sub' AND policy_digest='pol' AND probe_digest='prb'").all() as { attempt: number }[];
    expect(rows).toHaveLength(1);         // exactly ONE row despite three racing begins
    expect(rows[0].attempt).toBe(3);      // attempt bumped on each conflict
    db.close();
  });
});
