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
  // element-clipped: the composer is the subject, not the page around it
  { name: "composer", path: "/launch?do=pay", w: 1440, h: 1000, click: "text=Design gig", clip: ".cmp-grid", pad: 28 },
  { name: "composer-grant", path: "/launch?do=pay", w: 1440, h: 1200, click: "text=Grant in J$", clip: ".cmp-grid", pad: 28 },
  { name: "record-signals-tight", path: "/record/0x5db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048", w: 1440, h: 900, clip: ".rec-sig, [aria-label='Sage signals']", pad: 28 },
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
    // the floating mode pill and the feedback tab are app chrome for a signed-in founder; in a
    // still they photobomb the subject (measured: the pill sat over the composer's header)
    await page.addInitScript(() => {
      const st = document.createElement("style");
      st.textContent = ".mode-pill,[class*='feedback-fab'],button:has(> svg + span):where([class*='feedback']){display:none!important}";
      document.addEventListener("DOMContentLoaded", () => document.head.appendChild(st));
    });
    await page.goto(base + s.path, { waitUntil: "networkidle", timeout: 60_000 });
    await page.addStyleTag({ content: ".mode-pill{display:none!important} [class*='fb-']:has(> svg){display:none!important}" }).catch(() => {});
    await page.waitForTimeout(800);
    if (s.click) { await page.click(s.click, { timeout: 10_000 }).catch(() => {}); await page.waitForTimeout(600); }
    if (s.scrollTo) {
      const el = page.locator(s.scrollTo).first();
      await el.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
      // bring it under the fixed nav rather than flush to the top
      await page.evaluate(() => window.scrollBy(0, -88));
      await page.waitForTimeout(700);
    }
    if (s.clip) {
      const el = page.locator(s.clip).first();
      const box = await el.boundingBox();
      if (!box) throw new Error(`clip target not found: ${s.clip}`);
      const pad = s.pad ?? 0;
      await page.evaluate((y) => window.scrollTo(0, Math.max(0, y)), Math.max(0, box.y + (await page.evaluate(() => window.scrollY)) - pad));
      await page.waitForTimeout(400);
      const b2 = await el.boundingBox();
      await page.screenshot({ path: join(out, `${s.name}.png`), fullPage: false, clip: { x: Math.max(0, b2.x - pad), y: Math.max(0, b2.y - pad), width: Math.min(s.w - Math.max(0, b2.x - pad), b2.width + pad * 2), height: Math.min(s.h - Math.max(0, b2.y - pad), b2.height + pad * 2) } });
    } else {
      await page.screenshot({ path: join(out, `${s.name}.png`), fullPage: false });
    }
    console.log("shot", s.name);
  } catch (e) {
    console.log("FAILED", s.name, String(e.message).slice(0, 100));
  } finally {
    await ctx.close();
  }
}
await browser.close();
