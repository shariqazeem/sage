// THE LIVE WALKTHROUGH, CLICKED FOR REAL — founder and seller in two separate browser sessions on one
// machine (exactly like the laptop on stage), driving sagepays.xyz's real buttons. A scripted wallet
// (EIP-1193 + EIP-6963, announced as "Rehearsal Wallet") stands in for MetaMask: it signs the sign-in
// message and the evidence claim, nothing else (no transaction method is implemented).
//
//   node scripts/fc/rehearse-ui.mjs [--headed] [--shots <dir>]
//
// Founder: the dev key in .env (ARC_OPERATOR_PRIVATE_KEY). Seller: WORKER_KEY_FILE (a throwaway key
// whose address is on public/stage/shop.html). Keys are never printed. Prints a timing per step and
// saves a screenshot of every screen, which double as the deck's walkthrough backup.
import { chromium } from "playwright";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.SAGE_BASE ?? "https://sagepays.xyz";
// SENTENCE overrides the job (e.g. a cheaper J$80 run when the rehearsal account is low); the stage line is the default.
const SENTENCE = process.env.SENTENCE ?? "Put your shop's price list online: at least three items, each priced in Jamaican dollars, on a public page, and send me the link. I'll pay J$160.";
const SHOP = `${BASE}/stage/shop.html`;
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const SHOTS = arg("shots", "rehearsal-shots");
mkdirSync(SHOTS, { recursive: true });
const env = Object.fromEntries(readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n").map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")]));
const key = (k) => (k.startsWith("0x") ? k : `0x${k}`);
const founder = privateKeyToAccount(key(env.ARC_OPERATOR_PRIVATE_KEY));
const seller = privateKeyToAccount(key(readFileSync(process.env.WORKER_KEY_FILE, "utf8").trim()));

const t0 = Date.now();
const marks = [];
const mark = (label) => { const s = ((Date.now() - t0) / 1000).toFixed(1); marks.push([s, label]); console.log(`${s.padStart(6)} s  ${label}`); };
let shot = 0;
const snap = async (page, name) => { shot++; await page.screenshot({ path: path.join(SHOTS, `${String(shot).padStart(2, "0")}-${name}.png`) }); };

function walletScript(address) {
  return `(() => {
    const listeners = {}; let chainId = "0x4cef52";
    const provider = {
      request: async ({ method, params }) => {
        switch (method) {
          case "eth_requestAccounts": case "eth_accounts": return ["${address}"];
          case "eth_chainId": return chainId;
          case "net_version": return String(parseInt(chainId, 16));
          case "wallet_switchEthereumChain": case "wallet_addEthereumChain":
            chainId = params[0].chainId; (listeners.chainChanged || []).forEach((f) => f(chainId)); return null;
          case "personal_sign": return await window.__rehearsalSign("personal", params);
          case "eth_signTypedData_v4": return await window.__rehearsalSign("typed", params);
          default: throw Object.assign(new Error("Rehearsal Wallet does not do " + method), { code: 4200 });
        }
      },
      on: (e, f) => { (listeners[e] ||= []).push(f); },
      removeListener: (e, f) => { listeners[e] = (listeners[e] || []).filter((x) => x !== f); },
    };
    window.ethereum = provider;
    const info = { uuid: "5e1a0c8e-0000-4000-8000-000000000001", name: "Rehearsal Wallet", icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", rdns: "xyz.sagepays.rehearsal" };
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  })();`;
}

async function sessionFor(browser, account) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.exposeFunction("__rehearsalSign", async (kind, params) => {
    if (kind === "personal") {
      const [msg] = params;
      return account.signMessage({ message: /^0x[0-9a-f]*$/i.test(msg) ? { raw: msg } : msg });
    }
    const td = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
    const { EIP712Domain, ...types } = td.types;
    return account.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message });
  });
  await ctx.addInitScript(walletScript(account.address));
  return ctx;
}

// click the wallet option in whatever sign-in panel is open; connect first, then sign in
async function signInIfAsked(page) {
  // the site names a plain injected wallet "your Ethereum wallet"; first click connects, second signs
  for (let i = 0; i < 4; i++) {
    const opt = page.getByRole("button", { name: /Rehearsal Wallet|your Ethereum wallet|MetaMask/ });
    if (!(await opt.count())) return i > 0;
    await opt.first().click();
    await page.waitForTimeout(3000);
  }
  return true;
}

const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
try {
  // ── FOUNDER ───────────────────────────────────────────────────────────────────────────────────
  const fctx = await sessionFor(browser, founder);
  const fp = await fctx.newPage();
  await fp.goto(`${BASE}/launch?do=pay`, { waitUntil: "load" });
  mark("founder: composer open");
  const box = fp.locator("textarea").first();
  await box.fill(SENTENCE);
  await snap(fp, "composer");
  await fp.getByRole("button", { name: /Draft with Sage/ }).click();
  await fp.waitForTimeout(2000);
  if (await fp.getByText(/Sign in with your wallet to let Sage draft/).count()) {
    mark("founder: asked to sign in (on stage you are already signed in)");
    await signInIfAsked(fp);
    await fp.waitForTimeout(1500);
    await fp.getByRole("button", { name: /Draft with Sage/ }).click();
  }
  await fp.getByText(/Sage is drafting/).waitFor({ timeout: 15000 }).catch(() => {});
  mark("founder: drafting…");
  await fp.getByText(/Sage is drafting/).waitFor({ state: "detached", timeout: 120000 });
  await fp.waitForTimeout(1000);
  mark("founder: Sage's draft is in");
  await snap(fp, "drafted");
  const invite = fp.getByText(/Only people I invite/);
  if (await invite.count()) { await invite.first().click(); mark("founder: invite-only ticked"); }
  await snap(fp, "invite-only");
  await fp.getByRole("button", { name: /Create the gig|Create the grant/ }).click();
  mark("founder: compiling the plan…");
  await fp.waitForURL(/\/launch\/[A-Za-z0-9_-]{8,}/, { timeout: 120000 });
  const jobId = fp.url().split("/launch/")[1].split(/[?#]/)[0];
  mark(`founder: plan page (job ${jobId})`);
  // LIVE_CHIP picks the account door by its network name: "Arc" (mainnet, real USDC, the default) or "Arc Testnet"
  const chip = (process.env.LIVE_CHIP ?? "Arc").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const go = fp.getByRole("button", { name: new RegExp(`Let Sage launch it from your account on ${chip}$`) });
  await go.waitFor({ timeout: 60000 });
  await snap(fp, "plan");
  await go.click();
  mark("founder: launching from the account…");
  await fp.getByText(/The campaign is live/).waitFor({ timeout: 180000 });
  mark("founder: LIVE");
  await snap(fp, "launched");
  const board = await fp.getByRole("link", { name: /the board/ }).getAttribute("href");
  console.log(`         board: ${board}`);

  // ── SELLER (a separate session, like an incognito window) ─────────────────────────────────────
  const sctx = await sessionFor(browser, seller);
  const sp = await sctx.newPage();
  await sp.goto(board, { waitUntil: "load" });
  mark("seller: job page open");
  await snap(sp, "seller-board");
  // the board signs in on its own button: first click connects, second ("Sign in to submit") signs
  for (const label of [/Connect wallet to submit/, /Sign in to submit/]) {
    const btn = sp.getByRole("button", { name: label });
    if (await btn.count()) { await btn.first().click(); await sp.waitForTimeout(3000); }
  }
  mark("seller: signed in (on stage this is done before the talk)");
  await snap(sp, "seller-signed-in");
  await sp.getByRole("button", { name: /^Submit evidence/ }).first().click();
  const url = sp.locator('input[placeholder*="public link to your proof"]').first();
  await url.waitFor({ timeout: 30000 });
  await url.fill(SHOP);
  const note = sp.locator("textarea").first();
  if (await note.count()) await note.fill("My shop's price list is online: three items, each priced in Jamaican dollars.");
  await snap(sp, "seller-filled");
  await sp.getByRole("button", { name: /Sign \+ submit evidence/ }).click();
  mark("seller: SUBMITTED");
  await sp.waitForTimeout(2500);
  await snap(sp, "seller-submitted");
  // watch the job's own public journal until it pays or holds
  const deadline = Date.now() + 180000;
  let verdict = null;
  const cid = board.split("/c/")[1];
  while (Date.now() < deadline) {
    const j = await (await fetch(`${BASE}/api/campaigns/${cid}/public`, { cache: "no-store" })).json();
    const kinds = (j.activity ?? []).map((a) => a.kind);
    if (kinds.includes("paid")) { verdict = "PAID"; break; }
    if (kinds.includes("held") || kinds.includes("blocked")) { verdict = "HELD"; break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  mark(`seller: ${verdict ?? "no verdict in 3 min"}`);
  await sp.reload({ waitUntil: "load" });
  await sp.waitForTimeout(3000);
  await snap(sp, "seller-paid");
  const proof = sp.getByRole("link", { name: /proof/ }).first();
  if (verdict === "PAID" && (await proof.count())) {
    await proof.click();
    await sp.waitForLoadState("load");
    await sp.waitForTimeout(4000);
    mark("receipt open");
    await snap(sp, "receipt");
  }
  console.log("\nTIMELINE"); for (const [s, l] of marks) console.log(`${s.padStart(6)} s  ${l}`);
} finally {
  await browser.close();
}
