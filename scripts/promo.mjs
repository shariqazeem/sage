#!/usr/bin/env node
/**
 * PROMO CODES: giveaways that bring people in (21 Oct 2026).
 *
 * Two kinds:
 *   --days N      free days of a plan; nothing is paid. A workspace that never paid starts with renewal
 *                 off, so a giveaway never becomes a surprise charge.
 *   --percent N   N% off the FIRST payment for the plan (1-99). Renewals are always full price.
 * Each workspace can use a code once. Codes are upper-case letters, digits and dashes (3-32 long).
 * DRY RUN by default: it prints what it would do and changes nothing until you pass --apply.
 *
 * USAGE (on the VM, from /home/ubuntu/sage, so it uses the app's own database driver):
 *   node scripts/promo.mjs --list
 *   node scripts/promo.mjs --create RISE30 --plan pro --days 30 --uses 100 --expires 2026-12-31 --note "Metis Rise builders"
 *   node scripts/promo.mjs --create LAUNCH50 --plan pro --percent 50 --uses 200 --new-only --apply
 *   node scripts/promo.mjs --disable RISE30 --apply
 *
 * Share a code as a link that fills it in at checkout:
 *   https://sagepays.xyz/checkout?plan=pro&code=RISE30
 */
import Database from "better-sqlite3";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(`--${name}`);
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const DB_PATH = flag("db") ?? process.env.SAGE_DB_PATH ?? join(process.cwd(), "var", "sage.db");
const db = new Database(DB_PATH);
const now = Math.floor(Date.now() / 1000);
const day = (sec) => (sec ? new Date(sec * 1000).toISOString().slice(0, 10) : "never");
const PLANS = ["pro", "team"];
const normal = (raw) => {
  const code = String(raw ?? "").trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{2,31}$/.test(code) ? code : null;
};

if (has("list")) {
  const rows = db.prepare("select * from promo_codes order by created_at desc").all();
  if (rows.length === 0) console.log("No promo codes yet.");
  for (const r of rows) {
    const gives = r.kind === "days" ? `${r.days} free days` : `${r.percent_off}% off the first payment`;
    const left = r.max_uses == null ? "unlimited" : `${Math.max(0, r.max_uses - r.uses)} of ${r.max_uses} left`;
    const state = r.disabled_at ? "DISABLED" : r.expires_at && r.expires_at <= now ? "EXPIRED" : "active";
    console.log(`${r.code.padEnd(14)} ${r.plan.padEnd(5)} ${gives.padEnd(30)} used ${String(r.uses).padStart(4)}, ${left.padEnd(18)} expires ${day(r.expires_at)}  ${state}${r.new_only ? "  new customers only" : ""}${r.note ? `  (${r.note})` : ""}`);
  }
  process.exit(0);
}

if (has("disable")) {
  const code = normal(flag("disable"));
  if (!code) fail("Name the code: --disable CODE");
  const row = db.prepare("select * from promo_codes where code = ?").get(code);
  if (!row) fail(`No code ${code}.`);
  console.log(`disable ${code} (used ${row.uses} times)`);
  if (!has("apply")) {
    console.log("\nDry run. Nothing changed. Re-run with --apply to write it.");
    process.exit(0);
  }
  db.prepare("update promo_codes set disabled_at = ? where code = ?").run(now, code);
  console.log(`\nDone: ${code} no longer works. Redemptions already made are untouched.`);
  process.exit(0);
}

const code = normal(flag("create"));
if (!code) fail("Create a code with --create CODE (3-32 letters, digits or dashes), or use --list / --disable.");
const plan = String(flag("plan") ?? "").toLowerCase();
if (!PLANS.includes(plan)) fail(`--plan must be one of: ${PLANS.join(", ")}`);
const days = flag("days") !== undefined ? Number(flag("days")) : null;
const percent = flag("percent") !== undefined ? Number(flag("percent")) : null;
if ((days === null) === (percent === null)) fail("Give exactly one of --days N or --percent N.");
if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) fail("--days must be a whole number from 1 to 365.");
if (percent !== null && (!Number.isInteger(percent) || percent < 1 || percent > 99)) fail("--percent must be a whole number from 1 to 99 (use --days for a free period).");
const uses = flag("uses") !== undefined ? Number(flag("uses")) : null;
if (uses !== null && (!Number.isInteger(uses) || uses < 1)) fail("--uses must be a whole number of at least 1.");
let expires = null;
if (flag("expires") !== undefined) {
  const t = Date.parse(`${flag("expires")}T23:59:59Z`);
  if (!Number.isFinite(t) || t / 1000 <= now) fail("--expires must be a future date, written YYYY-MM-DD.");
  expires = Math.floor(t / 1000);
}
const newOnly = has("new-only") ? 1 : 0;
const note = flag("note") ?? null;
if (db.prepare("select 1 from promo_codes where code = ?").get(code)) fail(`${code} already exists. Disable it, or choose another code.`);

const gives = days !== null ? `${days} free days of ${plan}` : `${percent}% off the first ${plan} payment`;
console.log(`code     ${code}`);
console.log(`gives    ${gives}`);
console.log(`uses     ${uses ?? "unlimited"}, one per workspace`);
console.log(`expires  ${day(expires)}`);
console.log(`who      ${newOnly ? "new customers only (never paid)" : "anyone"}`);
if (note) console.log(`note     ${note}`);
console.log(`link     https://sagepays.xyz/checkout?plan=${plan}&code=${code}`);
if (!has("apply")) {
  console.log("\nDry run. Nothing changed. Re-run with --apply to write it.");
  process.exit(0);
}
db.prepare("insert into promo_codes (code, plan, kind, days, percent_off, max_uses, uses, expires_at, new_only, note, created_at, disabled_at) values (?,?,?,?,?,?,0,?,?,?,?,null)").run(
  code,
  plan,
  days !== null ? "days" : "percent",
  days,
  percent,
  uses,
  expires,
  newOnly,
  note,
  now,
);
console.log(`\nDone: ${code} is live.`);
