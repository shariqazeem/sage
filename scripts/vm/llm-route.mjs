/**
 * EVERY MODEL LANE ON ONE PROVIDER, IN ONE COMMAND, WITHOUT PRINTING A KEY (5 Nov 2026).
 *
 *   node scripts/vm/llm-route.mjs status      [--env .env]   which host and model each lane resolves to
 *   node scripts/vm/llm-route.mjs anthropic   [--env .env]   Claude on Anthropic's own endpoint
 *   node scripts/vm/llm-route.mjs commonstack [--env .env]   back to the routing saved before the first move
 *   node scripts/vm/llm-route.mjs recommended [--env .env]   the saved CommonStack routing, with drafting on Sonnet 5.5
 *   node scripts/vm/llm-route.mjs probe [--answer] [--env .env]   ask every configured model one tiny question (below)
 *
 * RECOMMENDED (measured 6 Nov 2026, Sage Bench, same 60 jobs, same payability audit): drafting is where model
 * quality decides whether a job can be paid at all. Sonnet 5.5 left 1 unpayable job, Haiku 5.5 left 13; at ~3.4
 * cents a draft it is cheap in absolute terms. Every other lane stays on the cheap, already-validated models
 * (MiniMax-M3 is an approved payout judge and passed P-GEN; Gemini Flash-Lite sees screenshots).
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
 *
 * PROBE (22 Nov 2026). Is each model the app would call actually ALIVE, before a battery or a founder's test
 * finds out the slow way? On 20-21 Nov two routings looked fine in `status` and were dead: every `anthropic/*`
 * model on CommonStack answered 500, and so did DeepSeek V4 Flash, on every real call. Staging's first look kept
 * its plain wording about 13 times before anyone looked. `probe` asks each distinct provider + model ONCE (lanes
 * that share one are listed together), one at a time:
 *   - default: at most 16 completion tokens each, so it passes even a key whose spending quota is nearly used
 *     (CommonStack checks each request's most it could cost). It proves the model answers at all: HTTP status,
 *     seconds, and the provider's own words on a refusal. A fraction of a cent in all.
 *   - `--answer`: room for a real answer (3,000 tokens) and a JSON reply to check, plus, for the vision models,
 *     a small solid-red picture and the question of its colour. A model that accepts images and answers without
 *     seeing them (MiniMax M3 does, measured 28 Aug) is reported as BLIND. A few cents at most.
 * Keys are never printed; a refusal's text is shown with anything key-shaped masked.
 */
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";

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

/** The app's own list (src/lib/llm/complete.ts `LANES`); tests/scripts/llm-route-lanes.test.ts holds the two together. */
const LANES = ["PAYOUT", "CONCIERGE", "MISSION", "OBS_JUDGE", "VISION", "DRAFT", "REPORT"];
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

/**
 * Every provider the app would call, resolved like the app does: a lane's full triple (complete.ts), else the
 * shared key and door with the lane's own model NAME or the shared model; the vision backup on the VISION lane's
 * key and door (vision.ts); the fallback's own triple. `status` prints these and `probe` calls them, so the two
 * can never disagree about where a lane goes.
 */
function targets(env) {
  const sharedKey = env.LLM_API_KEY || env.COMMONSTACK_API_KEY;
  const sharedBase = env.LLM_BASE_URL || env.COMMONSTACK_BASE_URL || "https://api.commonstack.ai/v1";
  const sharedModel = env.LLM_MODEL || env.DEPUTY_MODEL || "deepseek/deepseek-v4-flash";
  const rows = [{ label: "shared", key: sharedKey, base: sharedBase, model: sharedModel, inherits: false }];
  for (const l of LANES) {
    const full = env[`${l}_API_KEY`] && env[`${l}_BASE_URL`] && env[`${l}_MODEL`];
    // an unconfigured lane still sends its own model NAME on the shared key (missionModel(), CONCIERGE_MODEL, VISION_MODEL)
    rows.push(
      full
        ? { label: l, key: env[`${l}_API_KEY`], base: env[`${l}_BASE_URL`], model: env[`${l}_MODEL`], inherits: false }
        : { label: l, key: sharedKey, base: sharedBase, model: env[`${l}_MODEL`] || sharedModel, inherits: true },
    );
  }
  const vision = rows.find((r) => r.label === "VISION");
  rows.push({ label: "VISION backup", key: vision.key, base: vision.base, model: env.VISION_FALLBACK_MODEL || env.LLM_FALLBACK_MODEL || null, inherits: false });
  const fb = env.LLM_FALLBACK_API_KEY && env.LLM_FALLBACK_BASE_URL && env.LLM_FALLBACK_MODEL;
  rows.push({ label: "fallback", key: fb ? env.LLM_FALLBACK_API_KEY : null, base: env.LLM_FALLBACK_BASE_URL, model: fb ? env.LLM_FALLBACK_MODEL : null, inherits: false });
  return rows;
}

function status(env) {
  for (const r of targets(env)) {
    let v;
    if (r.label === "shared") v = r.key ? `${host(r.base)}  ${r.model}` : "(no key)";
    else if (r.label === "VISION backup") v = r.model || "(none)";
    else if (r.label === "fallback") v = r.key ? `${host(r.base)}  ${r.model}` : "(none)";
    else v = r.inherits ? `inherits shared → ${host(r.base)}  ${r.model}` : `${host(r.base)}  ${r.model}`;
    console.log(`${r.label.padEnd(14)} ${v}`);
  }
}

/* ───────────────────────────────────────────────────────────── probe ── */

/** A small solid-red PNG, built here so the picture is certain (no remembered base64). */
function redSquarePng(size = 32) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([230, 20, 20]))]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** A provider's words with anything key-shaped masked: a refusal may echo the key it refused. */
const masked = (t) => String(t).replace(/(sk|pk|ak|key)[-_][A-Za-z0-9_-]{8,}/gi, "$1-…").replace(/[A-Za-z0-9_-]{32,}/g, "…").replace(/\s+/g, " ").slice(0, 160);

/** What a model's text shows once its reasoning block is set aside. */
const answerOf = (content) => String(content ?? "").replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").trim();

async function ask(t, { maxTokens, image, timeoutMs }) {
  const url = `${t.base.replace(/\/+$/, "")}/chat/completions`;
  const content = image
    ? [
        { type: "text", text: "What single colour fills this picture? Answer with one word." },
        { type: "image_url", image_url: { url: image } },
      ]
    : 'Reply with exactly {"ok":true} and nothing else.';
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${t.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: t.model, messages: [{ role: "user", content }], max_tokens: maxTokens }),
      signal: ctl.signal,
    });
    const text = await res.text();
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* a gateway's HTML error page */
    }
    if (!res.ok) return { ok: false, status: res.status, secs, words: masked(data?.error?.message ?? data?.message ?? text) };
    const choice = data?.choices?.[0];
    return {
      ok: true,
      status: res.status,
      secs,
      finish: choice?.finish_reason ?? null,
      answer: answerOf(choice?.message?.content),
      thinking: data?.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      tokens: data?.usage?.completion_tokens ?? null,
    };
  } catch (e) {
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    return { ok: false, status: ctl.signal.aborted ? "timeout" : "network", secs, words: masked(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

/** One line a person can act on, from the provider's own status and words. */
function verdict(r, mode) {
  if (!r.ok) {
    const w = r.words ?? "";
    if (r.status === "timeout") return `NO ANSWER in ${r.secs}s`;
    if (r.status === "network") return `UNREACHABLE (${w})`;
    if (r.status === 402 || /insufficient|balance|credit/i.test(w)) return `OUT OF CREDIT (${r.status}: ${w})`;
    if (r.status === 429 && /quota exceeded|\bcap\s*\d/i.test(w)) return `KEY SPENDING LIMIT REACHED (429: ${w})`;
    if (r.status === 429) return `BUSY (429: ${w})`;
    if (r.status === 401 || r.status === 403) return `REFUSED THE KEY (${r.status}: ${w})`;
    if (r.status === 404 || (r.status === 400 && /model/i.test(w))) return `UNKNOWN MODEL (${r.status}: ${w})`;
    if (typeof r.status === "number" && r.status >= 500) return `BROKEN (${r.status}: ${w})`;
    return `REFUSED (${r.status}: ${w})`;
  }
  const cost = r.tokens != null ? `, ${r.tokens} tokens${r.thinking ? ` (${r.thinking} thinking)` : ""}` : "";
  if (mode === "tiny") return `alive, ${r.secs}s${cost}`;
  if (mode === "eye") {
    if (!r.answer) return `NO WORDS about the picture (${r.finish}), ${r.secs}s${cost}`;
    return /red/i.test(r.answer) ? `SEES (said "${r.answer.slice(0, 20)}"), ${r.secs}s${cost}` : `BLIND? said "${r.answer.slice(0, 60)}", ${r.secs}s${cost}`;
  }
  if (!r.answer) return r.finish === "length" ? `THOUGHT PAST ${r.tokens ?? "?"} TOKENS WITHOUT ANSWERING, ${r.secs}s` : `EMPTY ANSWER (${r.finish}), ${r.secs}s${cost}`;
  return /\{\s*"ok"\s*:\s*true\s*\}/.test(r.answer) ? `answers JSON, ${r.secs}s${cost}` : `answers, but not the JSON asked for ("${r.answer.slice(0, 40)}"), ${r.secs}s${cost}`;
}

async function probe(env, answer) {
  const groups = new Map();
  for (const t of targets(env)) {
    if (!t.key || !t.model || !t.base) continue;
    const id = `${t.base.replace(/\/+$/, "")}|${t.model}|${createHash("sha256").update(t.key).digest("hex").slice(0, 12)}`;
    if (!groups.has(id)) groups.set(id, { ...t, labels: [] });
    groups.get(id).labels.push(t.label);
  }
  if (groups.size === 0) {
    console.log("nothing to probe: no lane has a key, a door and a model");
    return;
  }
  console.log(
    answer
      ? `asking ${groups.size} provider/model pairs for a real answer (up to 3,000 tokens each; vision models also see a red square): a few cents at most\n`
      : `asking ${groups.size} provider/model pairs one tiny question (16 tokens each): a fraction of a cent in all\n`,
  );
  for (const g of groups.values()) {
    const who = g.labels.join(", ");
    console.log(`${who}\n  ${host(g.base)}  ${g.model}`);
    const r = await ask(g, { maxTokens: answer ? 3000 : 16, timeoutMs: answer ? 180_000 : 60_000 });
    console.log(`  ${verdict(r, answer ? "answer" : "tiny")}`);
    if (answer && r.ok && g.labels.some((l) => l.startsWith("VISION"))) {
      const eye = await ask(g, { maxTokens: 3000, image: redSquarePng(), timeoutMs: 120_000 });
      console.log(`  picture: ${verdict(eye, "eye")}`);
    }
  }
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

if (route === "probe") {
  await probe(env, args.includes("--answer"));
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
} else if (route === "commonstack" || route === "recommended") {
  if (!existsSync(SAVED)) {
    console.error(`nothing saved at ${SAVED}: the env was never moved by this script`);
    process.exit(2);
  }
  const next = parse(readFileSync(SAVED, "utf8"));
  if (route === "recommended") {
    // drafting on the gateway's Sonnet 5.5, on the same key and door the saved lanes use
    const key = next.PAYOUT_API_KEY || next.CONCIERGE_API_KEY || env.COMMONSTACK_API_KEY;
    const base = next.PAYOUT_BASE_URL || next.CONCIERGE_BASE_URL || env.COMMONSTACK_BASE_URL || "https://api.commonstack.ai/v1";
    if (!key) {
      console.error("no CommonStack key in the saved routing or COMMONSTACK_API_KEY");
      process.exit(2);
    }
    Object.assign(next, { DRAFT_API_KEY: key, DRAFT_BASE_URL: base, DRAFT_MODEL: "anthropic/claude-sonnet-5-5" });
  }
  console.log(`backup: ${backup()}`);
  writeFileSync(ENV, rewrite(text, next, route), { mode: 0o600 });
} else {
  console.error("usage: node scripts/vm/llm-route.mjs status|probe [--answer]|anthropic|commonstack|recommended [--env path]");
  process.exit(2);
}

console.log(`\n${ENV} now routes:`);
status(parse(readFileSync(ENV, "utf8")));
console.log("\nrestart to apply: pm2 restart sage --update-env");
