/**
 * SAGE ON X, FOR THE OPERATOR (relaunch, 20 Nov 2026).
 *
 *   node scripts/vm/x-agent.mjs            today's spend and the last 20 posts on record
 *   node scripts/vm/x-agent.mjs 50         the last 50
 *
 * Reads ./var/sage.db (or SAGE_DB_PATH) read-only. It prints what Sage posted, drafted, skipped or
 * failed to post, with the reason and the cost, the tags it read, and how the switches are set. It
 * says only whether each credential is present, never its value.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const limit = Math.min(200, Math.max(1, Number(process.argv[2]) || 20));
const path = process.env.SAGE_DB_PATH || join(process.cwd(), "var", "sage.db");
if (!existsSync(path)) {
  console.log(`no database at ${path}`);
  process.exit(0);
}

const SECRETS = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"];

/** The switches, from the process or the .env beside it. A credential is kept only as "set": its value never enters this script's memory as something printable. */
function envFile() {
  try {
    const out = {};
    for (const line of readFileSync(join(process.cwd(), ".env"), "utf8").split("\n")) {
      const m = /^\s*(X_[A-Z_]+)\s*=\s*["']?([^"'\n]*)["']?\s*$/.exec(line);
      if (m) out[m[1]] = SECRETS.includes(m[1]) ? (m[2].trim() ? "set" : "") : m[2];
    }
    return out;
  } catch {
    return {};
  }
}
const file = envFile();
const read = (k) => (SECRETS.includes(k) ? (process.env[k]?.trim() ? "set" : (file[k] ?? "")) : (process.env[k] ?? file[k] ?? "").trim());
const haveAll = SECRETS.every((k) => read(k).length > 0);
const asked = read("X_AGENT").toLowerCase();
const mode = asked === "live" ? (haveAll ? "live" : "dry (live asked, credentials missing)") : asked === "dry" ? "dry" : "off";
const ceiling = Number(read("X_DAILY_BUDGET_USD")) >= 0 && read("X_DAILY_BUDGET_USD") ? Number(read("X_DAILY_BUDGET_USD")) : 2;

const usd = (micros) => `$${(micros / 1e6).toFixed(3)}`;
const when = (sec) => (sec ? new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ") : "-");
const today = new Date().toISOString().slice(0, 10);

const db = new Database(path, { readonly: true, fileMustExist: true });
const has = (table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
if (!has("x_posts")) {
  console.log("the X tables are not here yet (migration 0072 has not run)");
  process.exit(0);
}

console.log(`Sage on X: ${mode}`);
console.log(`  replies ${read("X_REPLIES").toLowerCase() === "on" ? "on" : "off"}, tagged links a day ${read("X_INSPECTIONS_DAILY_CAP") || "10"}`);
console.log(`  credentials: ${SECRETS.map((k) => `${k} ${read(k) ? "set" : "missing"}`).join(", ")}`);

const spend = db.prepare("SELECT cost_micros, calls FROM x_spend WHERE day = ?").get(today);
const spent = spend?.cost_micros ?? 0;
console.log(`\n${today} (UTC)  ${usd(spent)} of $${ceiling} in ${spend?.calls ?? 0} charges${spent >= ceiling * 1e6 ? "  CEILING REACHED" : ""}`);
for (const d of db.prepare("SELECT day, cost_micros, calls FROM x_spend WHERE day < ? ORDER BY day DESC LIMIT 6").all(today)) {
  console.log(`${d.day}        ${usd(d.cost_micros)} in ${d.calls} charges`);
}

const counts = db.prepare("SELECT status, COUNT(*) AS n FROM x_posts GROUP BY status").all();
console.log(`\nposts on record: ${counts.map((c) => `${c.n} ${c.status}`).join(", ") || "none"}`);
for (const p of db.prepare("SELECT * FROM x_posts ORDER BY id DESC LIMIT ?").all(limit)) {
  console.log(`\n#${p.id}  ${when(p.created_at)}  ${p.kind}  ${p.status}${p.reason ? ` (${p.reason})` : ""}  ${p.subject_key}`);
  if (p.text) console.log(`  ${p.text}`);
  const facts = [p.tweet_id ? `https://x.com/i/status/${p.tweet_id}` : null, p.cost_micros ? usd(p.cost_micros) : null, p.in_reply_to ? `reply to ${p.in_reply_to}` : null].filter(Boolean);
  if (facts.length) console.log(`  ${facts.join("  ")}`);
}

const tags = db.prepare("SELECT state, COUNT(*) AS n FROM x_mentions GROUP BY state").all();
console.log(`\ntags read: ${tags.map((t) => `${t.n} ${t.state}`).join(", ") || "none"}`);
for (const m of db.prepare("SELECT * FROM x_mentions ORDER BY created_at DESC LIMIT 10").all()) {
  console.log(`  ${when(m.created_at)}  ${m.state}${m.reason ? ` (${m.reason})` : ""}  by ${m.author_username ?? m.author_id}  ${m.url ?? ""}${m.started_id ? `  inspection ${m.started_id}` : ""}`);
}
const until = db.prepare("SELECT value FROM x_cursor WHERE key = 'rate_limited_until'").get();
if (until && Number(until.value) * 1000 > Date.now()) console.log(`\nX rate limit until ${when(Number(until.value))} UTC`);
db.close();
