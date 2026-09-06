import { chromium } from "playwright";
const base = "https://sagepays.xyz"; const out = "docs/fc/data-room/screens";
const shots = [
  ["01-landing", "/"], ["02-explorer", "/explorer"], ["03-outcomes", "/outcomes"], ["04-marketplace", "/marketplace"],
  ["05-receipt-first-autonomous-payout", "/proof/0x8df7767860692a12fed6f90fe8a88d9a103686bbaa9ceee3d067a1e7c6250069"],
  ["06-receipt-private-leg-starknet", "/proof/0x2b03ed6532b29771723c996a667b468e367935d0c2ff839840d5f00656449fb"],
  ["07-work-record", "/record/0x41c4F9c6D5Bd1D970975436a875E94049D0e7699"],
  ["08-lender-view", "/lender?wallet=0x41c4F9c6D5Bd1D970975436a875E94049D0e7699"],
  ["09-wallet-graph", "/graph/gig-1c3e_FjffE"], ["10-docs-operator", "/docs/operator"], ["11-docs-privacy", "/docs/privacy"], ["12-docs-compliance", "/docs/compliance"],
  ["13-caribbean", "/caribbean"],
  ["14-statement", "/record/0x04f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434/statement"],
  ["15-seller-record", "/record/0x04f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434"],
  ["16-receipt-jmd-milestone", "/proof/0x2337afda7ef311c4bd515d66feb78f0903f16b3cc23e49ef7fb7702fe1bb54"],
];
// `node scripts/fc/data-room-screens.mjs 13-caribbean 16-receipt-jmd-milestone` captures only the named shots.
const only = process.argv.slice(2);
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
for (const [name, path] of shots) {
  if (only.length && !only.includes(name)) continue;
  try { await page.goto(base + path, { waitUntil: "load", timeout: 60000 }); await page.mouse.move(900, 450); await page.waitForTimeout(1800); await page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); console.log(name); } catch (e) { console.log(name, "FAILED", e.message.slice(0, 80)); }
}
await browser.close();
