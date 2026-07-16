#!/usr/bin/env node
/**
 * scripts/preflight.mjs — GO/NO-GO check before real-money autopilot.
 *
 * Read-only except (a) a 1-token LLM completion and (b) one test DM. Prints a PASS/FAIL table and
 * exits NON-ZERO if any check FAILs, so it can gate a deploy/canary.
 *
 *   npm run preflight <chatId> [campaignId]
 *
 * Run it where the app's env lives (the npm script loads .env). It hits the app's own sweep
 * endpoint and the real providers, so it proves the *deployed* configuration, not a copy.
 */
import { privateKeyToAccount } from "viem/accounts";

const chatId = process.argv[2];
const campaignId = process.argv[3];
const env = process.env;
const has = (k) => !!(env[k] && String(env[k]).trim());

const rows = [];
const PASS = "PASS", FAIL = "FAIL", INFO = "INFO", WARN = "WARN";
const add = (name, status, detail = "") => rows.push({ name, status, detail });

const armed = ["1", "true", "yes", "on"].includes(String(env.DEPUTY_AUTOPILOT_MAINNET || "").toLowerCase());

const GOAT_RPC = env.GOAT_RPC_URL || "https://rpc.goat.network";
const GOAT_USDC = "0x3022b87ac063DE95b1570F46f5e470F8B53112D8";
const GAS_FLOOR_BTC = 0.00001;

async function rpc(method, params) {
  const r = await fetch(GOAT_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  return j.result;
}

/* ─────────────────────────────── 1. ENV / config ─────────────────────────── */
async function checkEnv() {
  // LLM engine — a real 1-token completion proves engine "llm" is available (the keyless heuristic
  // can NEVER autopay), and prints who answered.
  const llmKey = env.LLM_API_KEY || env.COMMONSTACK_API_KEY;
  const base = (env.LLM_BASE_URL || env.COMMONSTACK_BASE_URL || "https://api.commonstack.ai/v1").replace(/\/+$/, "");
  const model = env.LLM_MODEL || env.DEPUTY_MODEL || "deepseek/deepseek-v4-flash";
  if (!llmKey) {
    add("LLM engine (autopay needs engine=llm)", FAIL, "no LLM_API_KEY/COMMONSTACK_API_KEY — brain is the keyword heuristic, CANNOT autopay");
  } else {
    try {
      const r = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${llmKey}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "reply with the word: ok" }], max_tokens: 1 }),
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) add("LLM engine (1-token completion)", FAIL, `HTTP ${r.status} from ${new URL(base).host}`);
      else {
        const j = await r.json();
        add("LLM engine (1-token completion)", j?.choices ? PASS : FAIL, `${new URL(base).host} · model=${j?.model || model}`);
      }
    } catch (e) {
      add("LLM engine (1-token completion)", FAIL, String(e.message || e).slice(0, 90));
    }
  }

  add("CONCIERGE_MODEL", has("CONCIERGE_MODEL") ? INFO : WARN, env.CONCIERGE_MODEL || "unset → falls back to LLM_MODEL/DEPUTY_MODEL");
  add("AUTOPAY_THRESHOLD", INFO, "0.85 (compile-time constant in brain-core.ts)");
  add("Telegram creds", has("TELEGRAM_BOT_TOKEN") && has("TELEGRAM_WEBHOOK_SECRET") ? PASS : FAIL, "bot token + webhook secret");
  add("Privy creds", has("PRIVY_APP_ID") && has("PRIVY_APP_SECRET") ? PASS : FAIL, "app id + secret (walletless custody)");
  const x402 = has("GOATX402_API_KEY") && has("GOATX402_API_SECRET") && has("GOATX402_MERCHANT_ID");
  add("x402 rail 1", INFO, x402 ? "PAID (all merchant creds present)" : "UNPAID fallback (honest bypass — evidence still verified)");
  add("Sweep cron secret", has("DEPUTY_CRON_SECRET") || has("CRON_SECRET") ? PASS : FAIL, has("DEPUTY_CRON_SECRET") ? "DEPUTY_CRON_SECRET" : has("CRON_SECRET") ? "CRON_SECRET" : "neither set → sweep endpoint closed");
  add("DEPUTY_AUTOPILOT_MAINNET", armed ? PASS : FAIL, armed ? "ARMED — real-money autopay ON" : "OFF — mainnet campaigns HOLD for manual approval");
}

/* ─────────────────────────────── 2. Chain (GOAT) ─────────────────────────── */
async function checkChain() {
  try {
    const bn = BigInt(await rpc("eth_blockNumber", []));
    add("GOAT RPC reachable", PASS, `${new URL(GOAT_RPC).host} · block ${bn}`);
  } catch (e) {
    add("GOAT RPC reachable", FAIL, String(e.message || e).slice(0, 90));
    return; // nothing else on-chain will work
  }

  // operator wallet gas (the settlement signer)
  const key = env.GOAT_AGENT_PRIVATE_KEY;
  if (!key) add("Operator BTC gas", FAIL, "GOAT_AGENT_PRIVATE_KEY unset — cannot sign GOAT settlements");
  else {
    try {
      const acct = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
      const bal = BigInt(await rpc("eth_getBalance", [acct.address, "latest"]));
      const btc = Number(bal) / 1e18;
      add("Operator BTC gas", btc >= GAS_FLOOR_BTC ? PASS : FAIL, `${acct.address} · ${btc} BTC (floor ${GAS_FLOOR_BTC})`);
    } catch (e) {
      add("Operator BTC gas", FAIL, String(e.message || e).slice(0, 90));
    }
  }

  // USDC contract readable (decimals() == 6)
  try {
    const hex = await rpc("eth_call", [{ to: GOAT_USDC, data: "0x313ce567" }, "latest"]);
    const dec = Number(BigInt(hex));
    add("USDC contract readable", dec === 6 ? PASS : WARN, `${GOAT_USDC} · decimals=${dec}`);
  } catch (e) {
    add("USDC contract readable", FAIL, String(e.message || e).slice(0, 90));
  }

  // factory has code
  const factory = env.GOAT_CAMPAIGN_FACTORY_ADDRESS;
  if (!factory) add("Vault factory has code", FAIL, "GOAT_CAMPAIGN_FACTORY_ADDRESS unset");
  else {
    try {
      const code = await rpc("eth_getCode", [factory, "latest"]);
      add("Vault factory has code", code && code !== "0x" ? PASS : FAIL, `${factory} · ${code && code !== "0x" ? (code.length - 2) / 2 + " bytes" : "NO CODE"}`);
    } catch (e) {
      add("Vault factory has code", FAIL, String(e.message || e).slice(0, 90));
    }
  }
}

/* ─────────────────────────────── 3. Sweep liveness ───────────────────────── */
async function checkSweep() {
  const secret = env.DEPUTY_CRON_SECRET || env.CRON_SECRET;
  const appUrl = (env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
  try {
    const r = await fetch(`${appUrl}/api/deputy/sweep`, {
      method: "POST",
      headers: { "x-deputy-cron-secret": secret || "", authorization: `Bearer ${secret || ""}` },
      signal: AbortSignal.timeout(25000),
    });
    let body = "";
    try { body = JSON.stringify(await r.json()).slice(0, 90); } catch { /* non-json */ }
    add("Sweep endpoint (auth + 200)", r.ok ? PASS : FAIL, `HTTP ${r.status} @ ${appUrl} ${body}`);
  } catch (e) {
    add("Sweep endpoint (auth + 200)", FAIL, `${appUrl} · ${String(e.message || e).slice(0, 70)}`);
  }
}

/* ─────────────────────────────── 4. Telegram ─────────────────────────────── */
async function checkTelegram() {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) { add("Telegram getMe", FAIL, "TELEGRAM_BOT_TOKEN unset"); return; }
  try {
    const me = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json());
    add("Telegram getMe", me?.ok ? PASS : FAIL, me?.ok ? `@${me.result.username}` : String(me?.description || "failed"));
  } catch (e) {
    add("Telegram getMe", FAIL, String(e.message || e).slice(0, 90));
  }
  if (!chatId) { add("Telegram test DM", WARN, "no chatId arg — usage: npm run preflight <chatId>"); return; }
  try {
    const dm = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: "Sage preflight: test DM OK. If you can read this, outbound Telegram works.", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    }).then((r) => r.json());
    add("Telegram test DM", dm?.ok ? PASS : FAIL, dm?.ok ? `delivered to ${chatId}` : String(dm?.description || "failed"));
  } catch (e) {
    add("Telegram test DM", FAIL, String(e.message || e).slice(0, 90));
  }
}

/* ─────────────────────── 5. Optional campaign snapshot ───────────────────── */
async function checkCampaign() {
  if (!campaignId) return;
  try {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(env.SAGE_DB_PATH || "var/sage.db", { readonly: true, fileMustExist: true });
    const c = db.prepare("SELECT id, status, reward_amount, max_recipients, chain_id FROM campaigns WHERE id = ?").get(campaignId);
    if (!c) { add(`Campaign ${campaignId}`, WARN, "not found in DB"); db.close(); return; }
    const paid = db.prepare("SELECT COUNT(*) n FROM submissions WHERE campaign_id = ? AND status = 'paid'").get(campaignId).n;
    const reward = Number(c.reward_amount || 0);
    const funded = reward * Number(c.max_recipients || 0);
    const spent = paid * reward;
    add(`Campaign ${campaignId} active`, c.status === "live" ? PASS : WARN, `status=${c.status}`);
    add(`Campaign ${campaignId} budget`, INFO, `funded ${(funded / 1e6).toFixed(2)} · paid ${(spent / 1e6).toFixed(2)} · remaining ${((funded - spent) / 1e6).toFixed(2)} USDC · per-tx ${(reward / 1e6).toFixed(2)} (daily velocity is on-chain)`);
    db.close();
  } catch (e) {
    add(`Campaign ${campaignId}`, WARN, String(e.message || e).slice(0, 90));
  }
}

/* ─────────────────────────────── run + report ────────────────────────────── */
function report() {
  const icon = (s) => (s === PASS ? "✓" : s === FAIL ? "✗" : s === WARN ? "!" : "·");
  const w = Math.max(...rows.map((r) => r.name.length));
  console.log("\n════════════════════ Sage preflight ════════════════════");
  console.log(armed ? "  DEPUTY_AUTOPILOT_MAINNET = ARMED  (real money WILL auto-pay)" : "  DEPUTY_AUTOPILOT_MAINNET = OFF   (campaigns hold for manual approval)");
  console.log("─────────────────────────────────────────────────────────");
  for (const r of rows) console.log(`  ${icon(r.status)} ${r.status.padEnd(4)}  ${r.name.padEnd(w)}   ${r.detail}`);
  const fails = rows.filter((r) => r.status === FAIL).length;
  const warns = rows.filter((r) => r.status === WARN).length;
  console.log("─────────────────────────────────────────────────────────");
  console.log(fails ? `  NO-GO — ${fails} FAIL${fails > 1 ? "s" : ""}${warns ? `, ${warns} warning(s)` : ""}` : `  GO — all checks pass${warns ? ` (${warns} warning(s))` : ""}`);
  console.log("═════════════════════════════════════════════════════════\n");
  process.exit(fails ? 1 : 0);
}

await checkEnv();
await checkChain();
await checkSweep();
await checkTelegram();
await checkCampaign();
report();
