/**
 * THE WALK — every website surface a founder, a worker, a lender or a judge opens, loaded in a real
 * browser under an Ethereum session, with console errors, failed requests and error pages recorded.
 * Then the two composer flows up to the funding step. Screenshots land in docs/fc/data-room/walk/.
 *   RECORD_KEY_FILE=… node scripts/fc/smoke-walk.mjs [https://sagepays.xyz]
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { siweCookie } from "../video/motion/data.mjs";
const base = process.argv[2] || "https://sagepays.xyz";
const out = "docs/fc/data-room/walk"; mkdirSync(out, { recursive: true });
const key = readFileSync(process.env.RECORD_KEY_FILE ?? "/private/tmp/claude-501/-Users-macbookair-projects-SAGE/2916cf8f-4f37-4010-95d9-25206656196f/scratchpad/record-key.txt", "utf8").split(/\s+/)[0];
const cookie = await siweCookie(key, base);
const host = new URL(base).host;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies(cookie.split("; ").map((kv) => { const i = kv.indexOf("="); return { name: kv.slice(0, i), value: kv.slice(i + 1), domain: host, path: "/" }; }));
const page = await ctx.newPage();
const errors = []; const failed = [];
page.on("console", (m) => { if (m.type() === "error") errors.push({ url: page.url(), text: m.text().slice(0, 160) }); });
page.on("response", (r) => { if (r.status() >= 500) failed.push({ url: r.url().slice(0, 120), status: r.status() }); });
const PAGES = ["/", "/start", "/workspace", "/workspace/autopilot", "/workspace/capital", "/workspace/settings", "/dashboard", "/launch", "/launch?do=pay", "/launch/direct", "/marketplace", "/explorer", "/outcomes", "/lender", "/lender?wallet=0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3", "/verify", "/record/0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3", "/agent", "/docs", "/docs/operator", "/docs/privacy", "/docs/compliance", "/docs/how-it-works", "/agents/sage", "/case-studies/autonomous-paid-testing", "/c/gig-1c3e_FjffE", "/graph/gig-1c3e_FjffE", "/proof/0x8df7767860692a12fed6f90fe8a88d9a103686bbaa9ceee3d067a1e7c6250069", "/proof/0x2b03ed6532b29771723c996a667b468e367935d0c2ff839840d5f00656449fb"];
const report = [];
for (const p of PAGES) {
  const before = errors.length, beforeF = failed.length;
  let status = 0, title = "", ms = 0, errorPage = false;
  const t0 = Date.now();
  try {
    const r = await page.goto(base + p, { waitUntil: "load", timeout: 60000 }); status = r?.status() ?? 0; ms = Date.now() - t0;
    await page.waitForTimeout(1200);
    title = (await page.title()).slice(0, 60);
    const body = await page.evaluate(() => document.body.innerText.slice(0, 4000));
    errorPage = /Application error|Internal Server Error|This page could not be found|Something went wrong/i.test(body);
    await page.screenshot({ path: `${out}/${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}.png` });
  } catch (e) { title = "FAILED " + String(e.message).slice(0, 60); }
  report.push({ p, status, ms, errorPage, consoleErrors: errors.length - before, failedRequests: failed.length - beforeF, title });
}
// the composer, up to the funding step: a gig from one sentence
let flow = {};
try {
  await page.goto(base + "/launch?do=pay", { waitUntil: "load", timeout: 60000 }); await page.waitForTimeout(1000);
  const ta = page.locator('textarea[placeholder^="e.g. Pay 5 people"]').first(); await ta.fill("Pay $2 to each of 3 people who publish a short public note on what confused them on sagepays.xyz, with their wallet address on the page.");
  await page.getByRole("button", { name: /draft with sage/i }).click();
  await page.getByRole("button", { name: /^draft with sage$/i }).waitFor({ state: "visible", timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(800);
  const pays = page.locator('input[type="number"]').first(); await pays.fill("2");
  const create = page.getByRole("button", { name: /create the (gig|bounty|grant)|create/i }).first();
  flow.createVisible = await create.isVisible().catch(() => false);
  flow.createEnabled = flow.createVisible ? await create.isEnabled().catch(() => false) : false;
  await page.screenshot({ path: `${out}/flow_composer_drafted.png` });
  if (flow.createEnabled) { await create.click(); await page.waitForTimeout(6000); flow.afterCreateUrl = page.url(); flow.afterCreateText = (await page.evaluate(() => document.body.innerText.slice(0, 600))).replace(/\s+/g, " "); await page.screenshot({ path: `${out}/flow_composer_after_create.png` }); }
} catch (e) { flow.error = String(e.message).slice(0, 200); }
console.log(JSON.stringify({ report, flow, consoleErrors: errors.slice(0, 20), failedRequests: failed.slice(0, 20) }, null, 1));
await browser.close();
