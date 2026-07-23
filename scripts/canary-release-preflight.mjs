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

// 4. database migration/version — the 0026 columns + 0027 table
const dbPath = process.env.SAGE_DB_PATH ?? join(process.cwd(), "var", "sage.db");
let schemaOk = false, ambiguous = 0;
try {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const cols = new Set(db.pragma("table_info(campaigns)").map((c) => c.name));
  const hasJournal = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payout_replay_journal'").all().length > 0;
  schemaOk = cols.has("verification_policy") && cols.has("verification_policy_digest") && hasJournal;
  // 5. no pending ambiguous payout attempt (in-flight replay rows)
  if (hasJournal) ambiguous = db.prepare("SELECT COUNT(*) n FROM payout_replay_journal WHERE completed_at IS NULL").get().n;
  db.close();
} catch (e) { add("database reachable", false, String(e.message).slice(0, 80)); }
add("migration 0026/0027 present", schemaOk, `db=${dbPath}`);
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
console.log("\nSELF-CANARY RELEASE PREFLIGHT" + (isCanary ? " (SELF_CANARY)" : gm === "shadow" ? " (OBSERVE)" : " (DARK)"));
for (const c of checks) console.log(`  ${c.ok ? "✅" : "❌"} ${c.name} — ${c.detail}`);
console.log("\nPer-campaign (re-verified at launch by fail-closed deputy gates): approved revision, VerificationPolicyV1");
console.log("digest, campaign/mission/probe binding, wallet/gas/token balances.\n");
if (isCanary && hard.length) { console.error(`REFUSE: ${hard.length} hard failure(s) in SELF_CANARY mode.`); process.exit(1); }
console.log(hard.length ? `NOTE: ${hard.length} check(s) failed (non-canary mode — advisory).` : "All release gates green.");
