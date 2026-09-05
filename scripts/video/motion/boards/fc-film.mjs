/**
 * THE FUTURE CARIBBEAN FILM — the script's eight scenes as one motion piece, 16:9. Every number
 * from the ledger, every insert a real recording, every claim in the caption the honest one.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as K from "../kit.mjs";
import { ledger, operatorMove } from "../data.mjs";
import { typeOn } from "./_shared.mjs";
const W = 1920, H = 1080;
const rec = (n) => `file://${resolve(`docs/posts/videos/rec/film/${n}.webm`)}`;
const marks = (n) => JSON.parse(readFileSync(`docs/posts/videos/rec/film/${n}.marks.json`, "utf8")).marks;
const dev = (o) => K.device({ ratio: 16 / 9, W, width: 0.6, ...o });
export async function build() {
  const L = await ledger();
  const decided = L.payouts + L.refused;
  let mv = null; try { mv = await operatorMove(readFileSync(process.env.RECORD_KEY_FILE ?? "/private/tmp/claude-501/-Users-macbookair-projects-SAGE/2916cf8f-4f37-4010-95d9-25206656196f/scratchpad/record-key.txt", "utf8").split(/\s+/)[0]); } catch {}
  const me = marks("explorer"), mc = marks("composer-grant"), mm = marks("marketplace"), mr = marks("receipts"), mg = marks("graph"), mrec = marks("record"), mo = marks("operator"), mout = marks("outcomes");
  const grant = "Give a market seller J$10,000 in two equal parts — half when her catalogue page is online with her wallet address on it, half when she posts her first customer review.";
  const S = []; // scenes as [layers…]
  // 1 · cold open — the ledger (0–22)
  S.push(K.layer(`<div class="big" style="font-size:calc(var(--W)*.13)"><span class="t">${K.count(0, L.paidUsd, 0.3, 1.6, { fmt: "usd" })}</span></div>` + K.words(`settled by an AI agent · ${L.payouts} verified payouts · ${L.refused} refused · two mainnet rails`, 1.8, { size: 0.03, step: 0.04 }), { out: 5.4, style: "align-items:flex-start" }));
  S.push(K.layer(dev({ src: rec("explorer"), at: 5.7, out: 21.6, seek: Math.max(0, (me.rows ?? 6) - 0.6), cap: "sagepays.xyz/explorer · every row is a transaction you can open", right: "live", focus: { x: 50, y: 30, scale: 1.35 } }) , { at: 5.6, out: 21.8, style: "align-items:center" }));
  S.push(K.caption("Every payment on this screen was decided by an AI agent. So was every refusal. No human reviewed any of them, and every line links to an on-chain receipt.", 6.2, 14.0));
  S.push(K.caption("Sage is not software a team logs into. It is an agent that moves money on verified work.", 14.3, 21.6));
  // 2 · the region's numbers (22–40)
  S.push(K.layer(`<div class="big" style="font-size:calc(var(--W)*.16)"><span class="t">7–9%</span></div>` + K.words("average fee on $20B+ of Caribbean remittances a year", 22.8, { size: 0.03, step: 0.05 }), { at: 22.0, out: 27.6, style: "align-items:flex-start" }));
  S.push(K.layer(`<div class="big" style="font-size:calc(var(--W)*.16)"><span class="t">80–90%</span></div>` + K.words("of Caribbean businesses are MSMEs — and lending is collateral-based", 28.6, { size: 0.03, step: 0.05 }), { at: 27.8, out: 33.4, style: "align-items:flex-start" }));
  S.push(K.layer(K.words("No credit file a lender can t:trust.", 33.8, { size: 0.075 }), { at: 33.6, out: 39.6 }));
  S.push(K.caption("In the Caribbean, moving money is expensive, and the businesses that are the economy can't borrow — not because they aren't good, but because nothing trustworthy records that they are.", 22.4, 39.4));
  // 3 · say the work in your own money (40–86)
  S.push(K.layer(`<div class="art" style="${K.anim("pop", 40.2, 0.7, 52.0)}"><div class="art-h"><span>Describe the work · sagepays.xyz/launch</span><span class="real">forms as you type</span></div><p class="art-t" style="font-size:calc(var(--W)*.024);font-weight:500;line-height:1.35">${typeOn(grant, 40.8, 40)}</p><div class="art-f" style="${K.anim("rise", 46.2, 0.6)}"><span>Sage drafts the brief, the criteria and the evidence rule · you set the money</span><b>Draft with Sage →</b></div></div>`, { at: 40.0, out: 52.2, style: "padding:0 18%" }));
  S.push(K.caption("You say the work once, in your own currency. Sage compiles it into milestones with a verification contract.", 41.0, 52.0));
  S.push(K.layer(dev({ src: rec("composer-grant"), at: 52.5, out: 70.0, seek: Math.max(0, (mc.priced ?? 60) - 0.8), cap: "the plan, compiled · J$10,000 in two milestones · converted once at a stamped rate", right: "sagepays.xyz/launch", focus: { x: 72, y: 34, scale: 1.55 } }), { at: 52.4, out: 70.2 }));
  S.push(K.caption("It stamps the rate, funds a vault with hard caps, and from here it spends without me — but it can never spend outside the vault's limits.", 53.0, 62.0));
  S.push(K.caption("The agent proposes. The vault disposes.", 62.3, 70.0));
  S.push(K.layer(K.tiles([{ v: K.count(0, 10000, 70.8, 1.4, { fmt: "jmd" }), k: "the grant, in the seller's money", cls: "ok" }, { v: "2", k: "milestones, each with its own evidence rule" }, { v: "J$5,000", k: "released on each verification" }, { v: "once", k: "converted at a stamped, source-attributed rate" }], 70.6, 0.16, 4), { at: 70.4, out: 85.6, style: "padding:0 6%" }));
  S.push(K.caption("Fourteen currencies. The founder types their number and never does exchange arithmetic.", 71.4, 85.4));
  // 4 · the door (86–106)
  S.push(K.layer(dev({ src: rec("marketplace"), at: 86.2, out: 97.6, seek: Math.max(0, (mm.rows ?? 5) - 0.4), cap: "the marketplace · public work carries the one-person-one-slot mark", right: "sagepays.xyz/marketplace", focus: { x: 50, y: 36, scale: 1.3 } }), { at: 86.0, out: 97.8 }));
  S.push(K.caption("Public work asks everyone to prove they are one person, once. No name, no document, no country — about a minute.", 86.8, 97.4));
  S.push(K.layer(K.words("Fifty slots need fifty t:people.", 98.2, { size: 0.075 }) + K.tiles([{ v: "12", k: "wallets" }, { v: "10 / 10", k: "slots taken" }, { v: "1", k: "person", cls: "no" }], 99.4, 0.14, 3), { at: 98.0, out: 105.8, style: "padding:0 12%" }));
  S.push(K.caption("The operator who took ten of ten slots with twelve wallets would have needed ten humans.", 99.0, 105.6));
  // 5 · paid privately, and the refusal (106–156)
  S.push(K.layer(dev({ src: rec("receipts"), at: 106.2, out: 124.0, seek: Math.max(0, (mr["b-leg"] ?? 34) - 0.6), cap: "a receipt · the private leg: vault released → escrowed behind a commitment → collected", right: "Starknet mainnet", focus: { x: 50, y: 40, scale: 1.4 } }), { at: 106.0, out: 124.2 }));
  S.push(K.caption("Recipients don't need a bank or a wallet app — chat is the account.", 106.8, 113.6));
  S.push(K.caption("Sage verifies the page, pays on Starknet into an escrow only the recipient can open, and publishes a receipt that proves the money moved without saying to whom.", 113.9, 124.0));
  S.push(K.layer(dev({ src: rec("graph"), at: 124.5, out: 138.0, seek: Math.max(0, (mg.scrolled ?? 8) - 0.2), cap: "the wallet graph · one operator, twelve wallets, drawn from the chain", right: "sagepays.xyz/graph", focus: { x: 50, y: 48, scale: 1.3 } }), { at: 124.4, out: 138.2 }));
  S.push(K.caption("And it refuses. This is a farm: one operator, twelve wallets, caught by the consolidation watch after the money moved.", 125.1, 138.0));
  S.push(K.layer(`<div class="big" style="font-size:calc(var(--W)*.14)"><span class="t">${K.count(0, L.refused, 138.6, 1.4)}</span></div>` + K.words(`of ${decided} judged decisions were refusals, each with the reason on the record.`, 140.0, { size: 0.036, step: 0.04 }), { at: 138.4, out: 155.6, style: "align-items:flex-start" }));
  S.push(K.caption("That discipline is the product: a rail that pays everything is a leak.", 141.2, 155.4));
  // 6 · the credit file and the capital back in (156–206)
  S.push(K.layer(dev({ src: rec("record"), at: 156.2, out: 172.0, seek: Math.max(0, (mrec.signals ?? 6) - 0.6), cap: "a work record · Sage signals: pass rate, verified inflow, tenure, distinct funders", right: "sagepays.xyz/record", focus: { x: 50, y: 34, scale: 1.35 } }), { at: 156.0, out: 172.2 }));
  S.push(K.caption("Every verified payout accrues to a work record with deterministic credit signals — published formulas over receipts, never a score.", 156.8, 171.8));
  S.push(K.layer(dev({ src: rec("record"), at: 172.5, out: 190.0, seek: Math.max(0, (mrec.capacity ?? 15) - 0.4), cap: "the lender's view · the facility as published arithmetic · the exact call an institution makes", right: "sagepays.xyz/lender", focus: { x: 50, y: 40, scale: 1.35 } }), { at: 172.4, out: 190.2 }));
  S.push(K.caption("And Sage lends against it: an advance sized by the lender's multiple on verified inflow, repaid by the next verified payouts through a waterfall.", 173.1, 183.0));
  S.push(K.caption("Capital out, capital back in, from the ledger the agent wrote. Built and dry-run against live records; the first disbursement is scheduled.", 183.3, 190.0));
  S.push(K.layer(K.words("Capital out.", 190.6, { size: 0.095 }) + K.words("Capital back in — from the ledger the agent t:wrote.", 191.5, { size: 0.06, step: 0.05 }), { at: 190.4, out: 205.6 }));
  // 7 · the operator (206–236)
  const goal = mv?.goal ?? "Watch real visitors land on sagepays.xyz and identify exactly where they hesitate or drop off.";
  const reason = mv?.reason ?? "Nothing has been learned on this surface yet, so the first evidence needed is how real people experience the landing page.";
  S.push(K.layer(K.artifact({ head: "Next move · sagepays.xyz", real: mv?.recorded ? "real run" : "rehearsal", title: `<span class="mono">${K.count(0, mv?.budgetBase ? mv.budgetBase / 1e6 : 5, 206.8, 1.1, { fmt: "usd" })}</span> testing run on <span class="mono">sagepays.xyz</span>`, rows: [{ k: "goal", text: goal }, { k: "why", text: reason }], foot: `<span>Sized as if the treasury held <b>$15</b> · nothing recorded until it moves</span><b>let it run →</b>`, at: 206.4, out: 220.0, stagger: 0.5, W }), { at: 206.2, out: 220.2, style: "padding:0 22%" }));
  S.push(K.caption("Fund it once and stop deciding. Sage chooses what work to buy next — where, never how much; the ceilings are yours.", 207.0, 214.0));
  S.push(K.caption("It proposes each move with its reason before a dollar leaves, and you can veto any move.", 214.3, 220.0));
  S.push(K.layer(dev({ src: rec("operator"), at: 220.4, out: 235.6, seek: Math.max(0, (mo.move ?? 30) + 0.3), cap: "the real page · sagepays.xyz/workspace/autopilot", right: "today, at $0", focus: { x: 50, y: 18, scale: 1.6 } }), { at: 220.3, out: 235.8 }));
  S.push(K.caption("The agent picks where to spend. It can never pick how much.", 221.0, 235.4));
  // 8 · close (236–262)
  S.push(K.layer(dev({ src: rec("outcomes"), at: 236.2, out: 248.0, seek: Math.max(0, (mout.fees ?? 8) - 0.4), cap: "sagepays.xyz/outcomes · the four readings against the track's own bar", right: "live", focus: { x: 50, y: 34, scale: 1.3 } }), { at: 236.0, out: 248.2 }));
  S.push(K.caption("Fees: a flat ten cents a settlement; recipients keep every cent. Settlement: minutes, verification included.", 236.8, 243.0));
  S.push(K.caption("Credit without collateral: an advance against verified inflow. Regional flow: obligations priced in the region's own currencies.", 243.3, 248.0));
  S.push(K.layer(K.tiles([{ v: "$0.10", k: "flat, per settlement · recipients keep 100%", cls: "ok" }, { v: L.median, k: "median, submit to paid" }, { v: "14", k: "currencies, Caribbean first" }, { v: "2", k: "mainnet rails · GOAT + Starknet" }], 248.6, 0.16, 4), { at: 248.4, out: 256.2, style: "padding:0 6%" }));
  S.push(K.layer(K.words("Built solo. Live on two mainnet rails. Real t:USDC.", 256.6, { size: 0.06, step: 0.06 }) + K.closeCard(258.4, "sagepays.xyz", "Sage"), { at: 256.4 }));
  return { size: [W, H], duration: 262, html: K.page({ W, H, body: S.join(""), cam: "animation:dolly 262s 0s both linear" }) };
}
