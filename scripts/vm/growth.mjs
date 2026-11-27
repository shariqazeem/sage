#!/usr/bin/env node
/**
 * THE FOUNDER'S DAILY NUMBERS (28 Nov 2026).   Usage: node scripts/vm/growth.mjs [--db <path>]
 *
 * Prints, for today (UTC), the last 7 days and the last 30: pastes (outside or ours, and outside by where
 * the builder came from), first looks, paid tests, testers, test visits by source, posts sent, and today's
 * model spend. Run it from the app's folder on the VM.
 *
 * READ-ONLY. It opens the app's database read-only with the app's own better-sqlite3 and writes nothing.
 * It prints counts and short wallet forms only: never a key, an email, a chat id or a tester's words.
 *
 * WHO IS "OURS" (everything else is "outside"):
 *   - Sage's own wallets: the `OWN_WALLETS` list in src/lib/campaigns/settled-ledger.ts, read from that
 *     file as it is on this machine (each entry there carries the evidence it is ours), and any account
 *     Sage holds for one of them (`agent_wallets`);
 *   - health checks and batteries: a `clawup:<ref>` owner whose ref names itself with words (the daily canary
 *     `selfdrive`, the batteries). Two kinds of ref are NOT ours, measured on prod on 27 Nov 2026: a number is a
 *     stranger's Telegram chat, and `mcp-<hash>` is an outside caller's AI agent over MCP (95 plans by then);
 *   - the operator's own chat: `clawup:<TELEGRAM_CHAT_ID>` from .env;
 *   - anything named in GROWTH_OURS (comma-separated owners or wallets), for a day's one-off.
 * A tag on X (`x:<id>`) and a stranger's Telegram chat are outside.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const cwd = process.cwd();
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const dbPath = arg("--db") || process.env.SAGE_DB_PATH || join(cwd, "var", "sage.db");
if (!existsSync(dbPath)) {
  console.error(`no database at ${dbPath} (run this from the app's folder, or pass --db)`);
  process.exit(2);
}
let Database;
try {
  Database = createRequire(join(cwd, "package.json"))("better-sqlite3");
} catch {
  console.error("better-sqlite3 is not installed here: run this from the app's folder, after npm install");
  process.exit(2);
}
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

/* ── helpers ─────────────────────────────────────────────────────────────── */
const tables = new Set(db.prepare("select name from sqlite_master where type = 'table'").all().map((r) => r.name));
const columns = (t) => (tables.has(t) ? new Set(db.prepare(`pragma table_info(${t})`).all().map((c) => c.name)) : new Set());
const all = (sql, ...params) => db.prepare(sql).all(...params);
const short = (a) => (typeof a === "string" && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : String(a));
const key = (w) => {
  const t = String(w ?? "").trim().toLowerCase();
  return t.startsWith("0x") && t.length > 42 ? `0x${t.slice(2).replace(/^0+/, "") || "0"}` : t;
};
const usd = (base) => `$${(base / 1e6).toFixed(2)}`;
const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const minutes = (sec) => (sec === null ? "—" : sec < 90 * 60 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(1)} h`);

const nowSec = Math.floor(Date.now() / 1000);
const dayStart = Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) / 1000);
const PERIODS = [
  { name: "today", since: dayStart },
  { name: "7 days", since: nowSec - 7 * 86400 },
  { name: "30 days", since: nowSec - 30 * 86400 },
];

/* ── who is ours ─────────────────────────────────────────────────────────── */
function ownWallets() {
  const file = join(cwd, "src", "lib", "campaigns", "settled-ledger.ts");
  if (!existsSync(file)) return [];
  const src = readFileSync(file, "utf8");
  const start = src.indexOf("export const OWN_WALLETS");
  if (start < 0) return [];
  const block = src.slice(start, src.indexOf("];", start));
  // only the quoted entries: an address inside a comment is evidence, not an entry
  return [...block.matchAll(/^\s*"(0x[0-9a-fA-F]{40,64})"/gm)].map((m) => key(m[1]));
}
function envValue(name) {
  if (process.env[name]) return process.env[name];
  try {
    const m = new RegExp(`^\\s*${name}\\s*=\\s*["']?([^"'\\n#]+)`, "m").exec(readFileSync(join(cwd, ".env"), "utf8"));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}
const ours = new Set(ownWallets());
const listed = ours.size;
for (const extra of (process.env.GROWTH_OURS || "").split(",")) if (extra.trim()) ours.add(key(extra));
const operatorChat = envValue("TELEGRAM_CHAT_ID");
if (operatorChat) ours.add(`clawup:${operatorChat.toLowerCase()}`);
// an account Sage holds for one of ours is ours too
const accountOwner = new Map();
if (tables.has("agent_wallets")) {
  for (const r of all("select privy_wallet_address as a, founder_address as f, chat_id as c from agent_wallets")) {
    accountOwner.set(key(r.a), key(r.f));
    if (ours.has(key(r.f))) ours.add(key(r.a));
  }
}
function isOurs(owner) {
  const k = key(owner);
  if (ours.has(k)) return true;
  if (k === "anonymous" || k.startsWith("x:")) return false;
  // a Telegram chat id is a number and an outside agent over MCP is `mcp-<hash>`; a health check names itself with words
  if (k.startsWith("clawup:")) return !/^clawup:-?\d+$/.test(k) && !k.startsWith("clawup:mcp-");
  const behind = accountOwner.get(k);
  return behind ? ours.has(behind) : false;
}

/* ── the rows ────────────────────────────────────────────────────────────── */
const since30 = PERIODS[2].since;
const jobCols = columns("inspection_jobs");
const jobs = tables.has("inspection_jobs")
  ? all(`select founder_wallet as owner, status, created_at as at, ${jobCols.has("via") ? "via" : "null as via"}, result from inspection_jobs where created_at >= ?`, since30).map((j) => {
      // a gig or a grant written by hand is a job, not a test of a product
      let kind = null;
      try {
        kind = j.result ? (JSON.parse(j.result)?.plan?.campaignKind ?? null) : null;
      } catch {
        kind = null;
      }
      return { owner: j.owner, status: j.status, at: j.at, via: j.via, kind };
    }).filter((j) => j.kind !== "gig" && j.kind !== "grant")
  : [];

const campCols = columns("campaigns");
const tests = tables.has("campaigns")
  ? all(
      `select id, poster_wallet as poster, created_at as at from campaigns
       where created_at >= ? and status != 'draft' and sandbox = 0
         ${campCols.has("kind") ? "and kind = 'testing'" : ""} ${campCols.has("vault_kind") ? "and vault_kind = 'campaign_v2'" : ""}`,
      since30,
    )
  : [];
const fundedOf = new Map();
const placesOf = new Map();
if (tables.has("missions")) {
  for (const m of all("select campaign_id as c, sum(reward_amount * max_completions) as funded, sum(max_completions) as places from missions group by campaign_id")) {
    fundedOf.set(m.c, m.funded ?? 0);
    placesOf.set(m.c, m.places ?? 0);
  }
}
const subsOf = new Map();
if (tables.has("submissions")) {
  for (const s of all("select campaign_id as c, wallet, status, created_at as at, decided_at as decided from submissions")) {
    if (!subsOf.has(s.c)) subsOf.set(s.c, []);
    subsOf.get(s.c).push(s);
  }
}

/* ── one period ──────────────────────────────────────────────────────────── */
function period(since) {
  const pastes = jobs.filter((j) => j.at >= since);
  const outside = pastes.filter((j) => !isOurs(j.owner));
  const byVia = new Map();
  for (const j of outside) byVia.set(j.via || "(none)", (byVia.get(j.via || "(none)") ?? 0) + 1);
  const looks = { ready: 0, asked: 0, failed: 0, moving: 0 };
  for (const j of pastes) {
    if (j.status === "ready") looks.ready += 1;
    else if (j.status === "needs_input") looks.asked += 1;
    else if (j.status === "failed") looks.failed += 1;
    else if (j.status !== "superseded") looks.moving += 1;
  }

  const paid = tests.filter((t) => t.at >= since);
  const paidOutside = paid.filter((t) => !isOurs(t.poster));
  const people = new Set();
  const toFirst = [];
  const toFull = [];
  let funded = 0;
  for (const t of paid) {
    funded += fundedOf.get(t.id) ?? 0;
    const subs = subsOf.get(t.id) ?? [];
    for (const s of subs) if (s.status === "paid") people.add(key(s.wallet));
    if (subs.length > 0) toFirst.push(Math.max(0, Math.min(...subs.map((s) => s.at)) - t.at));
    const paidAt = subs.filter((s) => s.status === "paid" && s.decided).map((s) => s.decided).sort((a, b) => a - b);
    const places = placesOf.get(t.id) ?? 0;
    if (places > 0 && paidAt.length >= places) toFull.push(Math.max(0, paidAt[places - 1] - t.at));
  }

  const count = (sql, ...p) => (db.prepare(sql).get(...p)?.n ?? 0);
  const visits = tables.has("test_visits") ? all("select source, count(*) as n from test_visits where first_at >= ? group by source order by n desc", since) : [];
  return {
    pastes: pastes.length,
    outside: outside.length,
    ours: pastes.length - outside.length,
    byVia: [...byVia].sort((a, b) => b[1] - a[1]),
    looks,
    paid: paid.length,
    paidOutside: paidOutside.length,
    funded,
    people: people.size,
    toFirst: median(toFirst),
    toFull: median(toFull),
    newAlerts: tables.has("work_alerts") ? count("select count(*) as n from work_alerts where created_at >= ?", since) : 0,
    signIns: tables.has("person_identities") ? all("select provider, count(*) as n from person_identities where created_at >= ? group by provider order by n desc", since) : [],
    visits,
    xPosts: tables.has("x_posts") ? count("select count(*) as n from x_posts where status = 'posted' and coalesce(posted_at, created_at) >= ?", since) : 0,
    channelPosts: tables.has("channel_posts") ? count("select count(*) as n from channel_posts where status = 'posted' and coalesce(posted_at, created_at) >= ?", since) : 0,
  };
}

/* ── print ───────────────────────────────────────────────────────────────── */
const P = PERIODS.map((p) => period(p.since));
const W = 30;
const row = (label, f) => console.log(`${label.padEnd(W)}${P.map((p) => String(f(p)).padStart(12)).join("")}`);
const head = (title) => console.log(`\n${title}`);
const pairs = (list) => (list.length ? list.map(([k, n]) => `${k} ${n}`).join(", ") : "—");

console.log(`Sage growth, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`);
console.log(`${"".padEnd(W)}${PERIODS.map((p) => p.name.padStart(12)).join("")}`);

head("PASTES (a product handed to Sage)");
row("  outside", (p) => p.outside);
row("  ours", (p) => p.ours);
for (const [i, p] of P.entries()) console.log(`  outside by via, ${PERIODS[i].name}: ${pairs(p.byVia)}`);
if (!jobCols.has("via")) console.log("  (this database has no `via` column yet: migration 0079 has not run here)");

head("FIRST LOOKS");
row("  ready", (p) => p.looks.ready);
row("  asked a question", (p) => p.looks.asked);
row("  failed", (p) => p.looks.failed);
row("  still working", (p) => p.looks.moving);

head("PAID TESTS (funded)");
row("  outside", (p) => p.paidOutside);
row("  ours", (p) => p.paid - p.paidOutside);
row("  funded", (p) => usd(p.funded));
row("  people paid", (p) => p.people);
row("  median to first answer", (p) => minutes(p.toFirst));
row("  median to full", (p) => minutes(p.toFull));

head("TESTERS");
const alerts = tables.has("work_alerts") ? db.prepare("select count(*) as n, sum(case when muted_at is null then 1 else 0 end) as active from work_alerts").get() : { n: 0, active: 0 };
console.log(`  on alerts now: ${alerts.active ?? 0} active of ${alerts.n ?? 0}`);
row("  new on alerts", (p) => p.newAlerts);
row("  social sign-ins", (p) => p.signIns.reduce((s, r) => s + r.n, 0));
for (const [i, p] of P.entries()) if (p.signIns.length) console.log(`  sign-ins by door, ${PERIODS[i].name}: ${pairs(p.signIns.map((r) => [r.provider, r.n]))}`);

head("TEST VISITS (people who opened a test's page, by first source)");
row("  visitors", (p) => p.visits.reduce((s, r) => s + r.n, 0));
for (const [i, p] of P.entries()) console.log(`  by source, ${PERIODS[i].name}: ${pairs(p.visits.map((r) => [r.source, r.n]))}`);
if (!tables.has("test_visits")) console.log("  (this database has no `test_visits` table yet: migration 0078 has not run here)");
const updates = tables.has("builder_channels") ? db.prepare("select count(*) as n from builder_channels where muted_at is null").get().n : 0;
console.log(`  builders with Telegram updates on: ${updates}`);

head("POSTS SENT");
row("  on X", (p) => p.xPosts);
row("  in the Telegram channel", (p) => p.channelPosts);

head("MODEL SPEND TODAY");
const spendPath = process.env.LLM_SPEND_PATH || join(cwd, "var", "llm-spend.json");
if (!existsSync(spendPath)) console.log("  nothing recorded here");
else {
  try {
    const today = (JSON.parse(readFileSync(spendPath, "utf8")).days ?? {})[new Date().toISOString().slice(0, 10)] ?? {};
    const accounts = Object.values(today);
    const total = accounts.reduce((s, a) => s + (a.usdMicro ?? 0), 0);
    const calls = accounts.reduce((s, a) => s + (a.calls ?? 0), 0);
    const budget = Number(envValue("LLM_DAILY_BUDGET_USD")) || null;
    console.log(`  $${(total / 1e6).toFixed(3)} in ${calls} calls${budget ? ` (${Math.round((total / (budget * 1e6)) * 100)}% of the $${budget} day)` : ""}`);
  } catch {
    console.log("  the spend book could not be read");
  }
}

head("WHO COUNTS AS OURS");
console.log(`  ${listed} of Sage's own wallets from settled-ledger.ts${listed ? ` (${[...ownWallets()].slice(0, 3).map(short).join(", ")}, …)` : " (file not found here: every wallet reads as outside)"}`);
console.log(`  health checks and batteries (clawup:<words>)${operatorChat ? ", the operator's own chat" : ""}${process.env.GROWTH_OURS ? ", and GROWTH_OURS" : ""}`);
db.close();
