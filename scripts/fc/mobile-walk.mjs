/** Every public and founder surface at phone width: horizontal overflow, error pages, console errors. */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { siweCookie } from "../video/motion/data.mjs";
const base = process.argv[2] || "https://sagepays.xyz"; const out = "docs/fc/data-room/walk-mobile"; mkdirSync(out, { recursive: true });
const key = readFileSync(process.env.RECORD_KEY_FILE ?? "/private/tmp/claude-501/-Users-macbookair-projects-SAGE/57b6c81c-2357-4601-8e05-ee881ecd7699/scratchpad/record-key.txt", "utf8").split(/\s+/)[0];
const cookie = await siweCookie(key, base); const host = new URL(base).host;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
await ctx.addCookies(cookie.split("; ").map((kv) => { const i = kv.indexOf("="); return { name: kv.slice(0, i), value: kv.slice(i + 1), domain: host, path: "/" }; }));
const page = await ctx.newPage(); const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !/Cross-Origin-Opener-Policy/.test(m.text())) errors.push(`${page.url().replace(base, "")}: ${m.text().slice(0, 120)}`); });
const PAGES = ["/", "/caribbean", "/marketplace", "/c/gig-1c3e_FjffE", "/explorer", "/outcomes", "/lender?wallet=0x41c4F9c6D5Bd1D970975436a875E94049D0e7699", "/record/0x41c4F9c6D5Bd1D970975436a875E94049D0e7699", "/record/0x41c4F9c6D5Bd1D970975436a875E94049D0e7699/statement", "/verify", "/start", "/workspace", "/workspace/autopilot", "/workspace/settings", "/workspace/people", "/launch?do=pay", "/launch/direct", "/dashboard", "/docs", "/docs/operator", "/proof/0x2b03ed6532b29771723c996a667b468e367935d0c2ff839840d5f00656449fb", "/graph/gig-1c3e_FjffE"];
const rows = [];
for (const p of PAGES) {
  try {
    const r = await page.goto(base + p, { waitUntil: "load", timeout: 60000 }); await page.waitForTimeout(1200);
    const m = await page.evaluate(() => { const w = window.innerWidth, sw = document.documentElement.scrollWidth; const wide = []; for (const el of document.querySelectorAll("body *")) { const rect = el.getBoundingClientRect(); if (rect.width > 0 && rect.right > w + 2 && rect.left < w) { wide.push((el.className && typeof el.className === "string" ? el.tagName.toLowerCase() + "." + el.className.split(" ").slice(0, 2).join(".") : el.tagName.toLowerCase()).slice(0, 48)); if (wide.length > 4) break; } } return { overflow: sw - w, wide, err: /Application error|Internal Server Error|Something went wrong/i.test(document.body.innerText) }; });
    await page.screenshot({ path: `${out}/${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}.png`, fullPage: true });
    rows.push(`${String(r?.status() ?? 0).padEnd(4)} ${String(m.overflow).padStart(4)}px ${m.err ? "ERRORPAGE" : "ok"} ${p}${m.wide.length ? "  ← " + m.wide.join(", ") : ""}`);
  } catch (e) { rows.push(`FAIL ${p} ${String(e.message).slice(0, 60)}`); }
}
console.log(rows.join("\n")); if (errors.length) console.log("console errors:\n" + errors.slice(0, 12).join("\n"));
await browser.close();
