/** Feed-sized images for posts: one screen per surface at 2× (2880×1800), never a full-page scroll. */
import { chromium } from "playwright";
const base = "https://sagepays.xyz"; const out = "docs/fc/data-room/post-images";
const shots = [
  ["landing", "/", 0], ["explorer", "/explorer", 0], ["receipt-first-payout", "/proof/0x8df7767860692a12fed6f90fe8a88d9a103686bbaa9ceee3d067a1e7c6250069", 0],
  ["receipt-private-leg", "/proof/0x2b03ed6532b29771723c996a667b468e367935d0c2ff839840d5f00656449fb", 900], ["work-record", "/record/0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3", 120],
  ["lender-view", "/lender?wallet=0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3", 0], ["outcomes", "/outcomes", 0], ["marketplace", "/marketplace", 0],
  ["wallet-graph", "/graph/gig-1c3e_FjffE", 60], ["operator-docs", "/docs/operator", 0],
];
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
for (const [name, path, y] of shots) {
  try { await page.goto(base + path, { waitUntil: "load", timeout: 60000 }); await page.mouse.move(900, 450); await page.waitForTimeout(1500); if (y) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(600); } await page.screenshot({ path: `${out}/${name}.png` }); console.log(name); } catch (e) { console.log(name, "FAILED", e.message.slice(0, 60)); }
}
await browser.close();
