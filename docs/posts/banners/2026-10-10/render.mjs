// Renders each banner HTML in this folder to a PNG at 2x (3200x1800) — sharp on X and LinkedIn.
//   node docs/posts/banners/2026-10-10/render.mjs [name ...]   (default: every *.html here)
import { chromium } from "playwright";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const names = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, ""));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
for (const n of names) {
  const page = await ctx.newPage();
  await page.goto(`file://${path.join(dir, `${n}.html`)}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(dir, `${n}.png`), clip: { x: 0, y: 0, width: 1600, height: 900 } });
  console.log(`✓ ${n}.png`);
  await page.close();
}
await browser.close();
