// THE DEMO SELLER, ON CUE BY ITSELF — so the person on stage only does the buyer side.
//
//   WORKER_KEY_FILE=<key> node scripts/fc/auto-seller.mjs --poster <0x… the buyer's account wallet> [--once]
//
// Watches prod for a NEW live job posted by that account (the account wallet is the job's poster when
// Sage launches from the account), then submits the demo shop page from the demo seller's wallet (the
// throwaway key whose address is on public/stage/shop.html) exactly as a person would: open the
// board, sign in, "Submit evidence", the link, "Sign + submit evidence". Prints each step and the
// verdict. Keeps watching for the next job unless --once. Keys are never printed.
import { chromium } from "playwright";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";

const BASE = "https://sagepays.xyz";
const SHOP = `${BASE}/stage/shop.html`;
const KEY = `${os.homedir()}/Documents/ssh-key3.key`;
const VM = "ubuntu@80.225.209.190";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const poster = (arg("poster") ?? "").toLowerCase();
if (!/^0x[0-9a-f]{40}$/.test(poster)) { console.error("usage: auto-seller.mjs --poster <0x… account wallet> [--once]"); process.exit(2); }
const once = process.argv.includes("--once");
const k = readFileSync(process.env.WORKER_KEY_FILE, "utf8").trim();
const seller = privateKeyToAccount(k.startsWith("0x") ? k : `0x${k}`);
const t = () => new Date().toLocaleTimeString("en-GB");
const done = new Set();

const QUERY = `
const db = require("/home/ubuntu/sage/node_modules/better-sqlite3")("/home/ubuntu/sage/var/sage.db", { readonly: true });
const rows = db.prepare("select id from campaigns where lower(poster_wallet) = ? and status = 'live' and created_at >= ? order by created_at desc limit 3").all(process.argv[2], Number(process.argv[3]));
console.log(JSON.stringify(rows.map((r) => r.id)));`;
execFileSync("ssh", ["-o", "ConnectTimeout=15", "-i", KEY, VM, "cat > /tmp/auto-seller-q.cjs"], { input: QUERY });
const since = Math.floor(Date.now() / 1000) - 60;
const newJobs = () => JSON.parse(execFileSync("ssh", ["-o", "ConnectTimeout=15", "-i", KEY, VM, `node /tmp/auto-seller-q.cjs ${poster} ${since}`], { encoding: "utf8", timeout: 30000 }).trim() || "[]");

function walletScript(address) {
  return `(() => { const listeners = {}; let chainId = "0x13b2";
    const provider = { request: async ({ method, params }) => { switch (method) {
      case "eth_requestAccounts": case "eth_accounts": return ["${address}"];
      case "eth_chainId": return chainId; case "net_version": return String(parseInt(chainId, 16));
      case "wallet_switchEthereumChain": case "wallet_addEthereumChain": chainId = params[0].chainId; (listeners.chainChanged || []).forEach((f) => f(chainId)); return null;
      case "personal_sign": return await window.__sellerSign("personal", params);
      case "eth_signTypedData_v4": return await window.__sellerSign("typed", params);
      default: throw Object.assign(new Error("no " + method), { code: 4200 }); } },
      on: (e, f) => { (listeners[e] ||= []).push(f); }, removeListener: (e, f) => { listeners[e] = (listeners[e] || []).filter((x) => x !== f); } };
    window.ethereum = provider;
    const info = { uuid: "5e1a0c8e-0000-4000-8000-000000000002", name: "Demo Seller Wallet", icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", rdns: "xyz.sagepays.demoseller" };
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce); announce(); })();`;
}

async function submit(cid) {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.exposeFunction("__sellerSign", async (kind, params) => {
      if (kind === "personal") { const [msg] = params; return seller.signMessage({ message: /^0x[0-9a-f]*$/i.test(msg) ? { raw: msg } : msg }); }
      const td = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1]; const { EIP712Domain, ...types } = td.types;
      return seller.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message });
    });
    await ctx.addInitScript(walletScript(seller.address));
    const p = await ctx.newPage();
    await p.goto(`${BASE}/c/${cid}`, { waitUntil: "load" });
    for (const label of [/Connect wallet to submit/, /Sign in to submit/]) {
      const btn = p.getByRole("button", { name: label });
      if (await btn.count()) { await btn.first().click(); await p.waitForTimeout(3000); }
    }
    await p.getByRole("button", { name: /^Submit evidence/ }).first().click();
    const url = p.locator('input[placeholder*="public link to your proof"]').first();
    await url.waitFor({ timeout: 30000 });
    await url.fill(SHOP);
    const note = p.locator("textarea").first();
    if (await note.count()) await note.fill("My shop's price list is online: three items, each priced in Jamaican dollars.");
    await p.getByRole("button", { name: /Sign \+ submit evidence/ }).click();
    console.log(`${t()}  SUBMITTED to ${cid}`);
    await p.waitForTimeout(2500);
  } finally {
    await browser.close();
  }
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const j = await (await fetch(`${BASE}/api/campaigns/${cid}/public`, { cache: "no-store" })).json().catch(() => ({}));
    const kinds = (j.activity ?? []).map((a) => a.kind);
    if (kinds.includes("paid")) return console.log(`${t()}  PAID  ${BASE}/c/${cid}`);
    if (kinds.includes("held") || kinds.includes("blocked")) return console.log(`${t()}  HELD  ${BASE}/c/${cid}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`${t()}  no verdict in 4 min  ${BASE}/c/${cid}`);
}

console.log(`${t()}  watching for a new live job posted by ${poster} (seller ${seller.address})`);
for (;;) {
  let ids = [];
  try { ids = newJobs(); } catch (e) { console.log(`${t()}  poll failed: ${String(e.message ?? e).split("\n")[0]}`); }
  const fresh = ids.find((id) => !done.has(id));
  if (fresh) {
    done.add(fresh);
    console.log(`${t()}  NEW JOB ${fresh} — submitting in 3 s`);
    await new Promise((r) => setTimeout(r, 3000));
    try { await submit(fresh); } catch (e) { console.log(`${t()}  submit failed: ${String(e.message ?? e).split("\n")[0]}`); }
    if (once) break;
  }
  await new Promise((r) => setTimeout(r, 2500));
}
