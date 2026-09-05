import { chromium } from "playwright";
const base = process.argv[2] || "http://localhost:3000"; const out = process.argv[3] || ".";
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base + "/", { waitUntil: "load", timeout: 90000 }); await page.waitForTimeout(2500);
await page.mouse.move(900, 450);
const smooth = async (y) => { await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: "instant" }), y); await page.waitForTimeout(700); };
await page.screenshot({ path: `${out}/s-hero.png` });
const howTop = await page.evaluate(() => document.querySelector("#how").getBoundingClientRect().top + window.scrollY);
const heads = await page.evaluate(() => [...document.querySelectorAll(".wf-chapter h3")].map((h) => h.getBoundingClientRect().top + window.scrollY));
const vh = 900;
for (let i = 0; i < heads.length; i++) { await smooth(heads[i] - vh * 0.42 + 40); await page.screenshot({ path: `${out}/s-ch${i}.png` }); }
// mid-transition between chapter 0 and 1
await smooth(heads[1] - vh * 0.42 - vh * 0.28 + 60); await page.screenshot({ path: `${out}/s-mid.png` });
await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })); await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/s-foot.png` });
console.log(JSON.stringify({ howTop, heads }));
await browser.close();
