#!/usr/bin/env node
/**
 * STAGE CHECK — GO or NO-GO before going live at Demo Day.
 *
 *   node scripts/fc/stage-check.mjs --job <backup campaignId> --worker <0x… seller wallet> [--buyer <0x… buyer account>]
 *
 * The live job is created on stage, so --job is the BACKUP: posted and launched beforehand, untouched.
 * --buyer is the founder's Arc mainnet account (the one that launches on stage): it must hold enough.
 * Checks every dependency of the live moment: the job's public page and feed (live, funded,
 * untouched, invite-only, on autopilot), the shop page (served, and carrying THIS worker's wallet,
 * which is the marker Sage requires), every AI lane answering through Sage's own config on the VM,
 * operator gas, the VM's disk and process, the deck file (rebuilt today, so its numbers are current)
 * and this Mac's free disk. Prints no secrets: the VM probe reports hosts, models, codes, timings.
 */
import { readFileSync, statSync, statfsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const KEY = `${process.env.HOME}/Documents/ssh-key3.key`;
const VM = "ubuntu@80.225.209.190";
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
// --receipt: a mainnet payout tx whose /proof page must open fast (it hung for minutes once, right after a restart)
const C = { site: "https://sagepays.xyz", live: arg("job"), worker: arg("worker"), buyer: arg("buyer"), shop: arg("shop") ?? "https://sagepays.xyz/stage/shop.html", receipt: arg("receipt") ?? "0x83aef6d39781b020de1421ca8e7042fe8a6af781fe31a249e3fe9f5d9ebff522" };
if (!C.live || !C.worker) { console.error("usage: stage-check.mjs --job <backup campaignId> --worker <0x… seller wallet> [--buyer <0x… buyer account>] [--shop <url>]"); process.exit(2); }

const rows = [];
const check = (name, ok, detail = "") => rows.push({ name, ok: ok === true ? "ok" : ok === "warn" ? "warn" : "FAIL", detail });
const get = async (url, as = "text") => {
  const t0 = Date.now();
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "cache-control": "no-cache" } });
  return { status: r.status, ms: Date.now() - t0, body: as === "json" ? await r.json().catch(() => null) : await r.text() };
};
const ssh = (cmd, input) => execFileSync("ssh", ["-o", "ConnectTimeout=15", "-i", KEY, VM, cmd], { input, encoding: "utf8", timeout: 240_000 });

// 1 · the pages the deck frames
for (const p of ["/", `/c/${C.live}`, `/record/${C.worker}`, `/proof/${C.receipt}`]) {
  try { const r = await get(C.site + p); check(`page ${p}`, r.status === 200 && (r.ms < 10_000 || "warn"), `${r.status} · ${r.ms} ms${r.ms >= 10_000 ? " — slow: open it once more before going live" : ""}`); }
  catch (e) { check(`page ${p}`, false, String(e.message ?? e)); }
}
try {
  const r = await get(C.shop);
  const marker = r.body.toLowerCase().includes(C.worker.toLowerCase());
  check("shop page served", r.status === 200, `${r.status} · ${C.shop}`);
  check("shop page carries the worker's wallet", marker, marker ? C.worker : `${C.worker} is NOT on the page: run scripts/fc/push-stage.sh after editing public/stage/shop.html`);
} catch (e) { check("shop page", false, String(e.message ?? e)); }

// 2 · the live job: live, nothing submitted yet, nothing being verified; the backup: already paid
try {
  const r = await get(`${C.site}/api/campaigns/${encodeURIComponent(C.live)}/public`, "json");
  const j = r.body ?? {};
  check("backup job is live", r.status === 200 && j.status === "live", `${r.status} · status ${j.status} · ${j.network}`);
  check("backup job untouched (0 paid, 0 in review)", j.paid === 0 && j.verifying === 0, `paid ${j.paid} · verifying ${j.verifying}`);
  // mission-plan jobs keep their slots in the plan (maxRecipients 0 here); "vault funded" below covers them
  if ((j.maxRecipients ?? 0) > 0) check("backup job has a slot", j.maxRecipients > (j.paid ?? 0), `${j.paid}/${j.maxRecipients} · reward $${j.rewardUsd}`);
} catch (e) { check("backup job", false, String(e.message ?? e)); }

// 2b · the buyer's account can launch the job on stage (on Arc mainnet USDC is also its gas)
if (C.buyer) {
  try {
    const data = "0x70a08231" + C.buyer.slice(2).toLowerCase().padStart(64, "0");
    const r = await (await fetch("https://rpc.mainnet.arc.io", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: "0x3600000000000000000000000000000000000000", data }, "latest"] }), signal: AbortSignal.timeout(20000) })).json();
    const usd = Number(BigInt(r.result)) / 1e6;
    check("buyer account can launch on stage", usd >= 2, `${usd.toFixed(2)} USDC on Arc mainnet (needs ≥ 2: the J$160 job is $1.01 plus gas, with one retry)`);
  } catch (e) { check("buyer account", false, String(e.message ?? e)); }
}

// 3 · the VM: Sage up, nothing stuck, disk, vault funding, operator gas, every AI lane answering
const VM_PROBE = String.raw`
import { readFileSync } from "node:fs";
const env = {};
for (const l of readFileSync(".env", "utf8").split("\n")) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ""); }
const out = {};
const D = (await import("/home/ubuntu/sage/node_modules/better-sqlite3/lib/index.js")).default;
const db = new D("var/sage.db", { readonly: true });
out.stuck = db.prepare("select count(*) n from submissions s left join decisions d on d.submission_id = s.id where s.status = 'settling' or (s.status = 'pending' and d.id is null)").get().n;
const camp = db.prepare("select id, chain_id, vault_address, reward_amount, autonomy, visibility, allowlist from campaigns where id = ?").get(process.argv[2]);
out.camp = camp ? { chain: camp.chain_id, vault: camp.vault_address, reward: camp.reward_amount, autonomy: camp.autonomy, visibility: camp.visibility, allowlist: camp.allowlist } : null;
const rpc = { 2345: env.GOAT_RPC_URL || "https://rpc.goat.network", 5042: env.ARC_MAINNET_RPC_URL || "https://rpc.mainnet.arc.io", 5042002: env.ARC_RPC_URL || "https://rpc.testnet.arc.io" };
const usdc = { 2345: "0x3022b87ac063DE95b1570F46f5e470F8B53112D8", 5042: "0x3600000000000000000000000000000000000000", 5042002: "0x3600000000000000000000000000000000000000" };
const call = async (url, method, params) => (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20000) })).json()).result;
if (camp && rpc[camp.chain_id] && camp.vault_address) {
  const data = "0x70a08231" + camp.vault_address.slice(2).toLowerCase().padStart(64, "0");
  try { out.vaultUsdc = Number(BigInt(await call(rpc[camp.chain_id], "eth_call", [{ to: usdc[camp.chain_id], data }, "latest"]))) / 1e6; } catch (e) { out.vaultErr = String(e.message); }
  const op = camp.chain_id === 2345 ? env.GOAT_OPERATOR_ADDRESS : camp.chain_id === 5042 ? env.ARC_MAINNET_OPERATOR_ADDRESS : env.ARC_OPERATOR_ADDRESS;
  if (op) { try { out.opGas = Number(BigInt(await call(rpc[camp.chain_id], "eth_getBalance", [op, "latest"]))) / 1e18; } catch (e) { out.opErr = String(e.message); } }
}
const lanes = {};
const shared = { key: env.LLM_API_KEY || env.COMMONSTACK_API_KEY, base: env.LLM_BASE_URL || env.COMMONSTACK_BASE_URL || "https://api.commonstack.ai/v1" };
for (const lane of ["PAYOUT", "CONCIERGE", "MISSION", "OBS_JUDGE", "FALLBACK"]) {
  const k = lane === "FALLBACK" ? env.LLM_FALLBACK_API_KEY : env[lane + "_API_KEY"], b = lane === "FALLBACK" ? env.LLM_FALLBACK_BASE_URL : env[lane + "_BASE_URL"], m = lane === "FALLBACK" ? env.LLM_FALLBACK_MODEL : env[lane + "_MODEL"];
  const p = k && b && m ? { key: k, base: b, model: m } : { ...shared, model: env.LLM_MODEL || env.DEPUTY_MODEL };
  const t0 = Date.now();
  try {
    const r = await fetch(p.base.replace(/\/$/, "") + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + p.key }, body: JSON.stringify({ model: p.model, max_tokens: 1500, messages: [{ role: "user", content: "Reply with the word ready" }] }), signal: AbortSignal.timeout(90000) });
    lanes[lane] = { status: r.status, ms: Date.now() - t0, host: new URL(p.base).host, model: p.model };
  } catch (e) { lanes[lane] = { status: 0, ms: Date.now() - t0, err: String(e.message).slice(0, 80) }; }
}
out.lanes = lanes;
console.log(JSON.stringify(out));
`;
try {
  ssh("cat > /tmp/stage-probe.mjs", VM_PROBE);
  const vm = JSON.parse(ssh(`cd /home/ubuntu/sage && node /tmp/stage-probe.mjs ${JSON.stringify(C.live)}; rm -f /tmp/stage-probe.mjs`).trim().split("\n").pop());
  check("nothing stuck in settlement", vm.stuck === 0, `${vm.stuck} pending/settling without a decision`);
  if (!vm.camp) check("backup job in the database", false, C.live);
  else {
    // isPublicWork (src/lib/campaigns/visibility.ts): public = listed AND no named recipients. Public
    // work asks a first-time worker for World ID and waits out the finalization window.
    let named = false; try { named = Array.isArray(JSON.parse(vm.camp.allowlist ?? "null")) && JSON.parse(vm.camp.allowlist).length > 0; } catch {}
    check("backup job is invite-only (pays at once)", named || vm.camp.visibility === "unlisted", `visibility ${vm.camp.visibility} · named recipients ${named ? "yes" : "no"}`);
    check("backup job on autopilot", vm.camp.autonomy === "autopilot", `autonomy ${vm.camp.autonomy}`);
    if (vm.vaultUsdc != null) check("backup vault funded", vm.vaultUsdc * 1e6 >= vm.camp.reward, `$${vm.vaultUsdc} in the vault · reward $${vm.camp.reward / 1e6} · chain ${vm.camp.chain}`);
    else check("backup vault funded", false, vm.vaultErr ?? `no RPC for chain ${vm.camp.chain}`);
    if (vm.opGas != null) check("operator has gas", vm.opGas > (vm.camp.chain === 2345 ? 0.00001 : 0.2), `${vm.opGas} native on chain ${vm.camp.chain}`);
    else check("operator has gas", "warn", vm.opErr ?? "operator address not configured for this chain");
  }
  for (const [lane, l] of Object.entries(vm.lanes)) check(`AI lane ${lane}`, l.status === 200, `${l.status} · ${l.ms} ms · ${l.host ?? ""} ${l.model ?? l.err ?? ""}`);
} catch (e) { check("VM probe", false, String(e.message ?? e).slice(0, 160)); }
try {
  const s = ssh(`df --output=avail -B1M / | tail -1; pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.name==="sage");console.log(p?p.pm2_env.status:"missing")})'`).trim().split("\n");
  check("VM disk free", Number(s[0]) > 2000, `${s[0]} MB`);
  check("Sage process", s[1] === "online", s[1]);
} catch (e) { check("VM health", false, String(e.message ?? e).slice(0, 160)); }

// 4 · this Mac
try {
  const f = statfsSync(process.env.HOME);
  const gb = (f.bavail * f.bsize) / 1e9;
  check("this Mac's free disk", gb >= 10 ? true : gb >= 5 ? "warn" : false, `${gb.toFixed(1)} GB`);
} catch (e) { check("this Mac's free disk", "warn", String(e.message ?? e)); }
try {
  const st = statSync(path.join(ROOT, "docs/fc/demo-day/Sage-DemoDay.pptx"));
  const today = new Date().toDateString() === st.mtime.toDateString();
  check("deck rebuilt today (fresh numbers)", today ? true : "warn", `Sage-DemoDay.pptx built ${st.mtime.toLocaleString()}${today ? "" : " — run node build-deck.js in docs/fc/demo-day/deck"}`);
} catch (e) { check("deck file", false, String(e.message ?? e)); }

const w = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) console.log(`${r.ok.padEnd(4)}  ${r.name.padEnd(w)}  ${r.detail}`);
const fails = rows.filter((r) => r.ok === "FAIL");
console.log(`\n${fails.length === 0 ? "GO" : `NO-GO: ${fails.map((f) => f.name).join(", ")}`}`);
process.exit(fails.length ? 1 : 0);
