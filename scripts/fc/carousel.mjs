/** "Sage in six receipts" — a LinkedIn document carousel (square pages → PDF), banker's language, real numbers. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const shots = (n) => `data:image/png;base64,${readFileSync(resolve("docs/fc/data-room/screens", n)).toString("base64")}`;
const L = { paid: "$63.60", payouts: 39, refused: 26, people: 24, median: "2m 55s" };
const page = (body, dark = false) => `<section class="pg ${dark ? "dark" : ""}">${body}</section>`;
const img = (n, style = "") => `<div class="shot" style="${style}"><img src="${shots(n)}"></div>`;
const pages = [
  page(`<div class="k">Future Caribbean 2026 · Finance, Payments & MSME Capital</div><h1>Sage in six receipts.</h1><p class="lede">An AI agent that pays people for verified work — and turns every payment into a credit record a lender can read.</p><div class="foot">sagepays.xyz · built solo · live with real money since July</div>`, true),
  page(`<div class="k">1 · The problem</div><h1><span class="t">80–90%</span> of Caribbean businesses are small. Lending is collateral-based.</h1><p class="lede">Moving money between islands costs 7–9% on more than $20bn a year. The work happens; nothing trustworthy records that it did.</p>`),
  page(`<div class="k">2 · What it does</div><h1>Say the work once, in your own currency. Sage verifies and pays.</h1><ul><li>A buyer describes the work in J$, TT$ or EC$ and funds it once.</li><li>The agent checks each deliverable itself and pays within minutes, inside spending limits enforced by code it cannot change.</li><li>Every payment leaves a public receipt.</li></ul>${img("01-landing.png", "height:38%")}`),
  page(`<div class="k">3 · The proof</div><h1><span class="t">${L.paid}</span> settled · ${L.payouts} verified payments · ${L.refused} refusals on record</h1><p class="lede">${L.people} people paid. Median ${L.median} from submission to payment. Every number on the site is read from the transactions themselves.</p>${img("02-explorer.png", "height:40%")}`),
  page(`<div class="k">4 · The system that says no</div><h1><span class="t">26 of 65</span> decisions were refusals — each with the reason on record.</h1><p class="lede">Sanctions screening on every payment path. One person, one slot on public work. A cash-flow record is only worth underwriting when the money behind it was verified before it moved.</p>`),
  page(`<div class="k">5 · The credit record</div><h1>Every payment lands on a record a lender can read in one call.</h1><ul><li>Inflow over 30 and 90 days, distinct payers, tenure, verification pass rate — published formulas, never a score.</li><li>A working-capital door: an advance sized from verified inflow, repaid from the next payments.</li></ul>${img("08-lender-view.png", "height:36%")}`),
  page(`<div class="k">6 · The ask</div><h1>The system is built. It needs the institutions it was built for.</h1><p class="lede">MSME programmes, cooperatives, contractor payrolls, lending desks that want to price cash flow instead of collateral.</p><div class="foot">sagepays.xyz · Shariq Shaukat · thank you, Future Caribbean</div>`, true),
];
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&family=JetBrains+Mono:wght@500&display=swap"><style>
@page{size:1080px 1080px;margin:0}html,body{margin:0}
.pg{width:1080px;height:1080px;box-sizing:border-box;padding:88px 92px;background:#fbfaf6;color:#171715;font-family:Inter,Helvetica,Arial,sans-serif;display:flex;flex-direction:column;gap:26px;page-break-after:always;position:relative;overflow:hidden}
.pg.dark{background:#17191c;color:#f3f1ea}
.k{font-family:"JetBrains Mono",monospace;font-size:20px;letter-spacing:.1em;text-transform:uppercase;color:#c2410c}
h1{font-size:62px;line-height:1.05;letter-spacing:-.035em;margin:0;font-weight:600}
.t{color:#c2410c}
.lede{font-size:30px;line-height:1.4;margin:0;color:inherit;opacity:.85;max-width:34ch}
ul{margin:0;padding-left:28px;font-size:28px;line-height:1.4}li{margin:10px 0}
.shot{margin-top:auto;border-radius:18px;overflow:hidden;border:1px solid rgba(23,23,21,.12);box-shadow:0 30px 60px -30px rgba(0,0,0,.4)}.shot img{display:block;width:100%;object-fit:cover;object-position:top}
.foot{position:absolute;left:92px;right:92px;bottom:70px;font-family:"JetBrains Mono",monospace;font-size:20px;opacity:.6}
</style></head><body>${pages.join("")}</body></html>`;
const browser = await chromium.launch(); const p = await browser.newPage();
await p.setContent(html, { waitUntil: "networkidle" }); await p.evaluate(() => document.fonts.ready);
await p.pdf({ path: "docs/fc/data-room/10-sage-in-six-receipts.pdf", width: "1080px", height: "1080px", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await browser.close(); console.log("docs/fc/data-room/10-sage-in-six-receipts.pdf");
