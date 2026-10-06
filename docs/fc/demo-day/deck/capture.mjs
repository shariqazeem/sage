// Captures the two real pages the deck shows, at 2x for a sharp projector image.
//   node docs/fc/demo-day/deck/capture.mjs <receipt-url> <record-url>
// Run it after the rehearsal payment you want on the slides (Saturday: the mainnet rehearsal), then
// rebuild the deck. A fresh signed-out browser: exactly what anyone opening the links would see.
//   receipt.png — the "Sage decision receipt" card: the verdict, the confidence against the 85% bar,
//                 and the judge's reason in its own words.
//   record.png  — the record's header, stats and Sage Signals. Three call-to-action cards meant for
//                 the wallet's owner (verify, alerts, privacy) are hidden in THIS screenshot only, for
//                 legibility; every figure shown is the live page's own.
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets");
const [receipt, record] = process.argv.slice(2);
if (!receipt || !record) { console.error("usage: capture.mjs <receipt-url> <record-url>"); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const open = async (url) => {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "load", timeout: 90_000 }); // live pages poll: they never go network-idle
  await page.waitForTimeout(6000);
  return page;
};

// the decision card
let page = await open(receipt);
let box = await page.evaluate(() => {
  const c = [...document.querySelectorAll("body *")].filter((e) => { const t = e.innerText || ""; return t.startsWith("Sage decision receipt") && /confidence/.test(t); })
    .sort((a, b) => { const A = a.getBoundingClientRect(), B = b.getBoundingClientRect(); return A.width * A.height - B.width * B.height; });
  const e = c.find((x) => x.getBoundingClientRect().height > 300) || c[0];
  const b = e.getBoundingClientRect(); return { x: b.left, y: b.top + scrollY, w: b.width };
});
const w1 = Math.round(box.w) + 32;
await page.screenshot({ path: path.join(dir, "receipt.png"), fullPage: true, clip: { x: Math.round(box.x) - 16, y: Math.round(box.y) - 16, width: w1, height: Math.round(w1 / 1.6) } });
console.log("captured receipt.png ←", receipt);
await page.close();

// the record excerpt
page = await open(record);
box = await page.evaluate(() => {
  const wide = (e) => { let n = e; while (n && n.parentElement && n.getBoundingClientRect().width < 1000) n = n.parentElement; return n; };
  for (const label of ["Verify once", "Turn on alerts"]) { const btn = [...document.querySelectorAll("button, a")].find((e) => (e.innerText || "").trim() === label); if (btn) wide(btn).style.display = "none"; }
  for (const start of ["Is this your record?", "Open this page in a browser"]) {
    const el = [...document.querySelectorAll("body *")].filter((e) => (e.innerText || "").trim().startsWith(start)).sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0];
    if (el) wide(el).style.display = "none";
  }
  const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left, y: b.top + scrollY, r: b.right, b: b.bottom + scrollY }; };
  const H = r(".rec-head"), S = r(".rec-signals");
  // stop above the export links: the slide is about the figures, at a size a room can read
  const links = [...document.querySelectorAll(".rec-signals *")].find((e) => /^Download this record/.test((e.innerText || "").trim()));
  const bottom = links ? links.getBoundingClientRect().top + scrollY - 26 : S.b;
  return { x: H.x, y: H.y, r: H.r, b: bottom };
});
const pad = 28;
await page.screenshot({ path: path.join(dir, "record.png"), fullPage: true, clip: { x: Math.round(box.x) - pad, y: Math.round(box.y) - pad, width: Math.round(box.r - box.x) + 2 * pad, height: Math.round(box.b - box.y) + 2 * pad } });
console.log("captured record.png ←", record);
await browser.close();
