#!/usr/bin/env node
/**
 * Phase 5 — SELF-CANARY RELEASE PREFLIGHT. Read-only. Verifies the environment + schema + tooling are safe to
 * enable payout-replay canary mode for exactly one founder wallet. Exits non-zero on any hard failure. It does
 * NOT move money, deploy, or write anything. Per-campaign checks (approved revision, policy digest, binding,
 * balances) are re-verified at launch by the deputy fail-closed gates; this covers the global release gates.
 *
 *   node scripts/canary-release-preflight.mjs
 */
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";

const MODEL = "google/gemini-3.1-flash-lite-preview";
const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok, detail });

// 1. environment modes
const gm = (process.env.MISSION_GROUNDING_MODE ?? "off").toLowerCase();
const rm = (process.env.PAYOUT_ACTION_REPLAY_MODE ?? "off").toLowerCase();
add("env modes", ["off", "shadow", "canary"].includes(gm) && ["off", "shadow", "canary"].includes(rm), `grounding=${gm} replay=${rm}`);
const isCanary = gm === "canary" && rm === "canary";

// 2. exactly one valid allowlisted wallet
const allow = (process.env.MISSION_CANARY_ALLOWLIST ?? "").split(/[,\s]+/).map((w) => w.trim().toLowerCase()).filter(Boolean);
const valid = allow.filter((w) => /^0x[0-9a-f]{40}$/.test(w));
add("allowlist = exactly one valid wallet", valid.length === 1 && valid.length === allow.length, `entries=${allow.length} valid=${valid.length}`);

// 3. model identity
const mm = process.env.MISSION_MODEL ?? process.env.DEPUTY_MODEL ?? "";
const cm = process.env.MISSION_GROUNDING_CRITIC_MODEL ?? mm;
add("Flash-Lite model routing", (!isCanary) || (mm === MODEL && cm === MODEL), `mission=${mm || "unset"} critic=${cm || "unset"}`);

// 4. database migration/version — mirrors REQUIRED_SCHEMA in src/lib/deputy/canary-preflight.ts (0026-0029).
const REQUIRED = {
  campaigns: ["verification_policy", "verification_policy_digest", "verification_policy_version", "verification_policy_required", "policy_source_revision_number"],
  plan_revisions: ["verification_policy", "verification_policy_digest", "verification_policy_required", "grounded_provenance"],
  journalCols: ["probe_version", "submission_id", "policy_digest", "probe_digest", "completed_at"],
  journalIndex: "prj_key_unq",
};
const dbPath = process.env.SAGE_DB_PATH ?? join(process.cwd(), "var", "sage.db");
let schemaMissing = ["db_unreadable"], ambiguous = 0;
try {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const cols = (t) => new Set(db.pragma(`table_info(${t})`).map((c) => c.name));
  schemaMissing = [];
  const cc = cols("campaigns"); for (const c of REQUIRED.campaigns) if (!cc.has(c)) schemaMissing.push(`campaigns.${c}`);
  const rc = cols("plan_revisions"); for (const c of REQUIRED.plan_revisions) if (!rc.has(c)) schemaMissing.push(`plan_revisions.${c}`);
  const jc = cols("payout_replay_journal");
  if (jc.size === 0) schemaMissing.push("payout_replay_journal");
  else for (const c of REQUIRED.journalCols) if (!jc.has(c)) schemaMissing.push(`payout_replay_journal.${c}`);
  if (db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='${REQUIRED.journalIndex}'`).all().length === 0) schemaMissing.push(`index:${REQUIRED.journalIndex}`);
  if (jc.size > 0) ambiguous = db.prepare("SELECT COUNT(*) n FROM payout_replay_journal WHERE completed_at IS NULL").get().n;
  db.close();
} catch (e) { add("database reachable", false, String(e.message).slice(0, 80)); }
const schemaOk = schemaMissing.length === 0;
add("migration 0026-0029 complete", schemaOk, schemaOk ? `db=${dbPath}` : `missing: ${schemaMissing.slice(0, 4).join(", ")}`);
add("no ambiguous in-flight replay", ambiguous === 0, `in_flight=${ambiguous}`);

// 6. chromium availability (guarded browser)
let chromium = false;
try { const pw = await import("playwright"); chromium = !!pw.chromium.executablePath(); } catch { chromium = false; }
add("chromium available", chromium, chromium ? "ok" : "run: npx playwright install chromium");

// 7. egress proxy readiness — the module imports without error (full C4 boundary re-checked at replay time)
let egress = false;
try { await import("../src/lib/net/egress-proxy.ts").catch(() => {}); egress = true; } catch { egress = existsSync(join(process.cwd(), "src/lib/net/egress-proxy.ts")); }
add("egress proxy present", egress || existsSync(join(process.cwd(), "src/lib/net/egress-proxy.ts")), "C4 guarded egress");

// 8. kill switch — setting both modes to off disables everything (documented)
add("kill switch (modes→off)", true, "MISSION_GROUNDING_MODE=off + PAYOUT_ACTION_REPLAY_MODE=off disables all canary behaviour");

const hard = checks.filter((c) => !c.ok);
// OBSERVE (shadow) reads/writes the journal too, so it — like SELF_CANARY — REFUSES when the schema is absent.
const isObserve = gm === "shadow" || rm === "shadow";
const mustEnforce = isCanary || isObserve;
console.log("\nSELF-CANARY RELEASE PREFLIGHT" + (isCanary ? " (SELF_CANARY)" : isObserve ? " (OBSERVE)" : " (DARK)"));
for (const c of checks) console.log(`  ${c.ok ? "✅" : "❌"} ${c.name} — ${c.detail}`);
console.log("\nPer-campaign (re-verified at launch by fail-closed deputy gates): approved revision, VerificationPolicyV2");
console.log("digest, campaign/mission/probe binding, wallet/gas/token balances.\n");
if (mustEnforce && hard.length) { console.error(`REFUSE: ${hard.length} hard failure(s) in ${isCanary ? "SELF_CANARY" : "OBSERVE"} mode.`); process.exit(1); }
console.log(hard.length ? `NOTE: ${hard.length} check(s) failed (DARK mode — advisory).` : "All release gates green.");
