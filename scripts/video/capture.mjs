/**
 * Capture REAL surfaces of the live product for the announcement videos. Every frame in a
 * Sage video is a screenshot of sagepays.xyz as it is — never a mock, never a comp.
 *
 *   node scripts/video/capture.mjs [--out dir] [--base https://sagepays.xyz]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const base = arg("base", "https://sagepays.xyz");
const out = arg("out", "docs/posts/videos/shots");
mkdirSync(out, { recursive: true });

const SHOTS = [
  { name: "landing-hero", path: "/", w: 1440, h: 900, scroll: 0 },
  { name: "landing-doors", path: "/", w: 1440, h: 900, scrollTo: ".dr" },
  { name: "landing-facts", path: "/", w: 1440, h: 900, scrollTo: ".tr" },
  { name: "landing-realrun", path: "/", w: 1440, h: 900, scrollTo: "#how" },
  { name: "landing-teams", path: "/", w: 1440, h: 900, scrollTo: "#teams" },
  { name: "landing-privacy", path: "/", w: 1440, h: 900, scrollTo: "#privacy" },
  { name: "landing-capital", path: "/", w: 1440, h: 900, scrollTo: "#capital" },
  { name: "explorer", path: "/explorer", w: 1440, h: 900 },
  { name: "outcomes", path: "/outcomes", w: 1440, h: 900 },
  { name: "outcomes-flow", path: "/outcomes", w: 1440, h: 900, scrollTo: "text=Increased capital flow" },
  { name: "record", path: "/record/0x5db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048", w: 1440, h: 900 },
  { name: "record-signals", path: "/record/0x5db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048", w: 1440, h: 900, scrollTo: "text=Sage signals" },
  { name: "lender", path: "/lender", w: 1440, h: 900 },
  { name: "marketplace", path: "/marketplace", w: 1440, h: 900 },
  { name: "composer", path: "/launch?do=pay", w: 1440, h: 1000, click: "text=Design gig", scrollTo: ".cmp-grid" },
  { name: "composer-grant", path: "/launch?do=pay", w: 1440, h: 1100, click: "text=Grant in J$", scrollTo: ".cmp-grid" },
  { name: "board", path: "/c/gig-CNTNilT30v", w: 1440, h: 900 },
  { name: "proof", path: "/proof/0x2b03ed6532b29771723c996a667b468e367935d0c2ff839840d5f00656449fb", w: 1440, h: 900 },
  { name: "launch", path: "/launch", w: 1440, h: 900 },
  { name: "docs-settlement", path: "/docs/settlement", w: 1440, h: 900 },
  { name: "m-landing", path: "/", w: 390, h: 844, mobile: true },
  { name: "m-explorer", path: "/explorer", w: 390, h: 844, mobile: true },
  { name: "m-record", path: "/record/0x5db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048", w: 390, h: 844, mobile: true },
];

const browser = await chromium.launch();
for (const s of SHOTS) {
  const ctx = await browser.newContext({
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: 2,
    isMobile: !!s.mobile,
    hasTouch: !!s.mobile,
    colorScheme: "light",
    reducedMotion: "reduce", // reveal-on-scroll must not leave blanks in a still
  });
  const page = await ctx.newPage();
  try {
    await page.goto(base + s.path, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(800);
    if (s.click) { await page.click(s.click, { timeout: 10_000 }).catch(() => {}); await page.waitForTimeout(600); }
    if (s.scrollTo) {
      const el = page.locator(s.scrollTo).first();
      await el.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
      // bring it under the fixed nav rather than flush to the top
      await page.evaluate(() => window.scrollBy(0, -88));
      await page.waitForTimeout(700);
    }
    await page.screenshot({ path: join(out, `${s.name}.png`), fullPage: false });
    console.log("shot", s.name);
  } catch (e) {
    console.log("FAILED", s.name, String(e.message).slice(0, 100));
  } finally {
    await ctx.close();
  }
}
await browser.close();
