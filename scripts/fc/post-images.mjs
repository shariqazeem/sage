/** Feed-sized images for posts: one screen per surface at 2× (2880×1800), never a full-page scroll. */
import { chromium } from "playwright";
const base = "https://sagepays.xyz"; const out = "docs/fc/data-room/post-images";
const shots = [
  ["landing", "/", 0], ["explorer", "/explorer", 0], ["receipt-first-payout", "/proof/0x8df7767860692a12fed6f90fe8a88d9a103686bbaa9ceee3d067a1e7c6250069", 0],
  ["receipt-private-leg", "/proof/0x2b03ed6532b29771723c996a667b468e367935d0c2ff839840d5f00656449fb", 900], ["work-record", "/record/0x41c4F9c6D5Bd1D970975436a875E94049D0e7699", 120],
  ["lender-view", "/lender?wallet=0x41c4F9c6D5Bd1D970975436a875E94049D0e7699", 0], ["outcomes", "/outcomes", 0], ["marketplace", "/marketplace", 0],
  ["wallet-graph", "/graph/gig-1c3e_FjffE", 60], ["operator-docs", "/docs/operator", 0],
  ["receipt-jmd", "/proof/0x2337afda7ef311c4bd515d66feb78f0903f16b3cc23e49ef7fb7702fe1bb54", 0],
  ["receipt-jmd-private-leg", "/proof/0x2337afda7ef311c4bd515d66feb78f0903f16b3cc23e49ef7fb7702fe1bb54", 900],
  ["seller-record", "/record/0x04f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434", 120],
  ["caribbean-proven", "/caribbean", 3950],
];
// `node scripts/fc/post-images.mjs receipt-jmd seller-record` captures only the named shots.
const only = process.argv.slice(2);
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
for (const [name, path, y] of shots) {
  if (only.length && !only.includes(name)) continue;
  try { await page.goto(base + path, { waitUntil: "load", timeout: 60000 }); await page.mouse.move(900, 450); await page.waitForTimeout(1500); if (y) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(600); } await page.screenshot({ path: `${out}/${name}.png` }); console.log(name); } catch (e) { console.log(name, "FAILED", e.message.slice(0, 60)); }
}
await browser.close();
