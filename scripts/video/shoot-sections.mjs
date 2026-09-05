import { chromium } from "playwright";
const base = process.argv[2] || "http://localhost:3000"; const out = process.argv[3] || ".";
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base + "/", { waitUntil: "load", timeout: 90000 }); await page.waitForTimeout(2500); await page.mouse.move(900, 450);
const tops = await page.evaluate(() => [...document.querySelectorAll("main > section")].map((s) => ({ cls: s.className.split(" ")[0], top: s.getBoundingClientRect().top + window.scrollY, h: s.getBoundingClientRect().height })));
for (const s of tops) { for (let k = 0; k * 800 < s.h && k < 4; k++) { await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), s.top - 60 + k * 800); await page.waitForTimeout(800); await page.screenshot({ path: `${out}/sec-${s.cls}-${k}.png` }); } }
console.log(JSON.stringify(tops)); await browser.close();
