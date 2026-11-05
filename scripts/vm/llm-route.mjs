/**
 * EVERY MODEL LANE ON ONE PROVIDER, IN ONE COMMAND, WITHOUT PRINTING A KEY (5 Nov 2026).
 *
 *   node scripts/vm/llm-route.mjs status      [--env .env]   which host and model each lane resolves to
 *   node scripts/vm/llm-route.mjs anthropic   [--env .env]   Claude on Anthropic's own endpoint
 *   node scripts/vm/llm-route.mjs commonstack [--env .env]   back to the routing saved before the first move
 *
 * Then restart the app: `pm2 restart sage --update-env` (Next reads .env at boot).
 *
 * Why it exists: on 5 Nov 2026 the CommonStack account behind every lane ran dry, and the founder put a
 * Claude credit (expiring 11 Nov) into production until it is topped up. Moving eight lanes by hand is
 * how a lane gets left half-configured, and a half-configured lane is silently ABSENT (complete.ts:
 * all three of key, base URL and model, or the lane inherits the shared chain).
 *
 * - `anthropic` reads the key from ~/.config/sage/anthropic.env (ANTHROPIC_EVAL_KEY) and points the
 *   shared chain and every lane at it. The fallback (LLM_FALLBACK_*) is left alone: it stays on the
 *   other account, which is the only kind of fallback that survives one account running dry.
 * - Before the first move it saves the lines it will change to ~/.config/sage/llm-route-commonstack.env,
 *   so `commonstack` restores exactly what ran before, and removes what `anthropic` added.
 * - Every write keeps a timestamped copy of the env file next to it first, mode 600.
 * Values are never printed: `status` shows hosts and model names only.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const route = args[0];
const envFlag = args.indexOf("--env");
const ENV = resolve(envFlag >= 0 ? args[envFlag + 1] : ".env");
const DIR = join(homedir(), ".config/sage");
const SAVED = join(DIR, "llm-route-commonstack.env");

const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
/** Claude Sonnet 5.5 on every lane: measured on Sage Bench (drafts, judge, concierge) on 5 Nov 2026. */
const ANTHROPIC_MODEL = "claude-sonnet-5-5";
/** The backup eye: a second model on the same provider when a screenshot stalls (vision.ts). */
const ANTHROPIC_VISION_BACKUP = "claude-haiku-5-5";

const LANES = ["PAYOUT", "CONCIERGE", "MISSION", "OBS_JUDGE", "VISION", "DRAFT"];
/** Every line a route owns. LLM_FALLBACK_* is deliberately not one of them. */
const OWNED = ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", ...LANES.flatMap((l) => [`${l}_API_KEY`, `${l}_BASE_URL`, `${l}_MODEL`]), "VISION_FALLBACK_MODEL"];

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
const unquote = (v) => v.trim().replace(/^["']|["']$/g, "");

function parse(text) {
  const out = {};
  for (const l of text.split("\n")) {
    const m = LINE.exec(l);
    if (m) out[m[1]] = unquote(m[2]);
  }
  return out;
}

function host(url) {
  try {
    return new URL(url).host;
  } catch {
    return url || "(none)";
  }
}

/** Resolve like the app does (complete.ts): a lane's full triple, else the shared chain. */
function status(env) {
  const sharedKey = env.LLM_API_KEY || env.COMMONSTACK_API_KEY;
  const sharedBase = env.LLM_BASE_URL || env.COMMONSTACK_BASE_URL || "https://api.commonstack.ai/v1";
  const sharedModel = env.LLM_MODEL || env.DEPUTY_MODEL || "deepseek/deepseek-v4-flash";
  const rows = [["shared", sharedKey ? `${host(sharedBase)}  ${sharedModel}` : "(no key)"]];
  for (const l of LANES) {
    const full = env[`${l}_API_KEY`] && env[`${l}_BASE_URL`] && env[`${l}_MODEL`];
    // an unconfigured lane still sends its own model NAME on the shared key (missionModel(), CONCIERGE_MODEL, VISION_MODEL)
    const model = full ? env[`${l}_MODEL`] : env[`${l}_MODEL`] || sharedModel;
    rows.push([l, full ? `${host(env[`${l}_BASE_URL`])}  ${env[`${l}_MODEL`]}` : `inherits shared → ${host(sharedBase)}  ${model}`]);
  }
  rows.push(["VISION backup", env.VISION_FALLBACK_MODEL || env.LLM_FALLBACK_MODEL || "(none)"]);
  const fb = env.LLM_FALLBACK_API_KEY && env.LLM_FALLBACK_BASE_URL && env.LLM_FALLBACK_MODEL;
  rows.push(["fallback", fb ? `${host(env.LLM_FALLBACK_BASE_URL)}  ${env.LLM_FALLBACK_MODEL}` : "(none)"]);
  for (const [k, v] of rows) console.log(`${k.padEnd(14)} ${v}`);
}

/** Rewrite owned lines in place, append new ones, drop the ones `next` leaves out. Comments survive. */
function rewrite(text, next, label) {
  const seen = new Set();
  const lines = [];
  for (const l of text.split("\n")) {
    if (l.startsWith("# llm-route:")) continue; // the marker of an earlier move; a fresh one is written below
    const m = LINE.exec(l);
    if (m && OWNED.includes(m[1])) {
      if (seen.has(m[1])) continue; // a duplicate would shadow the value we write
      seen.add(m[1]);
      if (next[m[1]] !== undefined) lines.push(`${m[1]}=${next[m[1]]}`);
      continue;
    }
    lines.push(l);
  }
  const added = Object.keys(next).filter((k) => !seen.has(k));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (added.length) lines.push("", `# llm-route: ${label} (${new Date().toISOString()})`, ...added.map((k) => `${k}=${next[k]}`));
  return `${lines.join("\n")}\n`;
}

function backup() {
  const to = `${ENV}.bak-llm-route-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(ENV, to);
  chmodSync(to, 0o600);
  return to;
}

if (!existsSync(ENV)) {
  console.error(`no env file at ${ENV}`);
  process.exit(2);
}
const text = readFileSync(ENV, "utf8");
const env = parse(text);

if (route === "status" || !route) {
  status(env);
  process.exit(0);
}

if (route === "anthropic") {
  const file = join(DIR, "anthropic.env");
  const m = existsSync(file) ? /^ANTHROPIC_EVAL_KEY=(sk-ant-\S+)$/m.exec(readFileSync(file, "utf8")) : null;
  if (!m) {
    console.error(`no Claude key: ${file} must hold ANTHROPIC_EVAL_KEY=sk-ant-…`);
    process.exit(2);
  }
  // Save what runs now, once: a second `anthropic` must never overwrite the saved CommonStack routing.
  if (!existsSync(SAVED)) {
    if (/api\.anthropic\.com/.test(text)) {
      console.error(`refusing: ${ENV} already routes to Anthropic and no CommonStack routing is saved at ${SAVED}`);
      process.exit(2);
    }
    mkdirSync(DIR, { recursive: true, mode: 0o700 });
    const keep = OWNED.filter((k) => env[k] !== undefined).map((k) => `${k}=${env[k]}`);
    writeFileSync(SAVED, `# saved by llm-route.mjs before moving to Anthropic (${new Date().toISOString()})\n${keep.join("\n")}\n`, { mode: 0o600 });
    console.log(`saved the current routing (${keep.length} lines) to ${SAVED}`);
  }
  const key = m[1];
  const next = { LLM_API_KEY: key, LLM_BASE_URL: ANTHROPIC_BASE, LLM_MODEL: ANTHROPIC_MODEL, VISION_FALLBACK_MODEL: ANTHROPIC_VISION_BACKUP };
  for (const l of LANES) Object.assign(next, { [`${l}_API_KEY`]: key, [`${l}_BASE_URL`]: ANTHROPIC_BASE, [`${l}_MODEL`]: ANTHROPIC_MODEL });
  console.log(`backup: ${backup()}`);
  writeFileSync(ENV, rewrite(text, next, "anthropic"), { mode: 0o600 });
} else if (route === "commonstack") {
  if (!existsSync(SAVED)) {
    console.error(`nothing saved at ${SAVED}: the env was never moved by this script`);
    process.exit(2);
  }
  const next = parse(readFileSync(SAVED, "utf8"));
  console.log(`backup: ${backup()}`);
  writeFileSync(ENV, rewrite(text, next, "commonstack"), { mode: 0o600 });
} else {
  console.error("usage: node scripts/vm/llm-route.mjs status|anthropic|commonstack [--env path]");
  process.exit(2);
}

console.log(`\n${ENV} now routes:`);
status(parse(readFileSync(ENV, "utf8")));
console.log("\nrestart to apply: pm2 restart sage --update-env");
