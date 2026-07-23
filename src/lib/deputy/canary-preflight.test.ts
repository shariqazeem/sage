import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { verifyPayoutReplaySchema, REQUIRED_SCHEMA } from "./canary-preflight";

/** P3 — the unified schema verifier: clean-install / 0025-upgrade / partially-migrated / malformed-index. */

const DRIZZLE = path.resolve("drizzle");
const files = fs.readdirSync(DRIZZLE).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
function migrated(upTo: string): Database.Database {
  const db = new Database(":memory:");
  for (const f of files) { if (f.slice(0, 4) > upTo) break; for (const s of fs.readFileSync(path.join(DRIZZLE, f), "utf8").split("--> statement-breakpoint")) { const t = s.trim(); if (t) db.exec(t); } }
  return db;
}
const probe = (db: Database.Database) => ({ all: (q: string) => db.prepare(q).all() as unknown[] });

describe("verifyPayoutReplaySchema — unified preflight", () => {
  it("CLEAN install (all migrations) → ok, nothing missing", () => {
    const db = migrated("9999");
    expect(verifyPayoutReplaySchema(probe(db))).toEqual({ ok: true, missing: [] });
    db.close();
  });
  it("PREVIOUS schema (0025) → not ready, lists every 0026-0029 column/table/index", () => {
    const db = migrated("0025");
    const r = verifyPayoutReplaySchema(probe(db));
    expect(r.ok).toBe(false);
    for (const c of REQUIRED_SCHEMA.campaigns) expect(r.missing).toContain(`campaigns.${c}`);
    for (const c of REQUIRED_SCHEMA.plan_revisions) expect(r.missing).toContain(`plan_revisions.${c}`);
    expect(r.missing).toContain("payout_replay_journal");
    db.close();
  });
  it("PARTIALLY migrated (0026 only: campaign policy cols, no journal / rev cols) → not ready", () => {
    const db = migrated("0026");
    const r = verifyPayoutReplaySchema(probe(db));
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("payout_replay_journal");                 // 0027 absent
    expect(r.missing).toContain("plan_revisions.verification_policy");     // 0028 absent
    expect(r.missing).not.toContain("campaigns.verification_policy");      // 0026 present
    db.close();
  });
  it("MALFORMED (journal table present but the unique index dropped) → not ready (index missing)", () => {
    const db = migrated("9999");
    db.exec(`DROP INDEX ${REQUIRED_SCHEMA.payout_replay_journal.uniqueIndex}`);
    const r = verifyPayoutReplaySchema(probe(db));
    expect(r.ok).toBe(false);
    expect(r.missing).toContain(`index:${REQUIRED_SCHEMA.payout_replay_journal.uniqueIndex}`);
    db.close();
  });
});
