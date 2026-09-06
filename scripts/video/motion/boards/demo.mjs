/**
 * THE DEMO — one three-minute piece for both hackathons, narrated by the founder. The loop
 * (say the work → funded → verified → paid → receipt), the private leg on Starknet, the credit
 * file and the lender's view, the operator. Every insert a real recording, every number the
 * ledger's, captions carry it muted.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as K from "../kit.mjs";
import { ledger, operatorMove } from "../data.mjs";
import { typeOn } from "./_shared.mjs";
const W = 1920, H = 1080;
const rec = (n) => `file://${resolve(`docs/posts/videos/rec/film/${n}.webm`)}`;
const marks = (n) => JSON.parse(readFileSync(`docs/posts/videos/rec/film/${n}.marks.json`, "utf8")).marks;
const dev = (o) => K.device({ ratio: 16 / 9, W, width: 0.62, ...o });
export async function build() {
  const L = await ledger();
  const decided = L.payouts + L.refused;
  let mv = null; try { mv = await operatorMove(readFileSync(process.env.RECORD_KEY_FILE ?? "/private/tmp/claude-501/-Users-macbookair-projects-SAGE/2916cf8f-4f37-4010-95d9-25206656196f/scratchpad/record-key.txt", "utf8").split(/\s+/)[0]); } catch {}
  const me = marks("explorer"), mc = marks("composer-grant"), mm = marks("marketplace"), mr = marks("receipts"), mg = marks("graph"), mrec = marks("record"), mo = marks("operator"), mout = marks("outcomes");
  const grant = "Give a market seller J$10,000 in two equal parts — half when her catalogue page is online with her wallet address on it, half when she posts her first customer review.";
  const S = [];
  // 0–14 · the ledger
  S.push(K.layer(`<div class="big" style="font-size:calc(var(--W)*.13)"><span class="t">${K.count(0, L.paidUsd, 0.3, 1.5, { fmt: "usd" })}</span></div>` + K.words(`settled by an AI agent · ${L.payouts} verified payouts · ${L.refused} refused · two mainnet rails`, 1.7, { size: 0.03, step: 0.04 }), { out: 5.0, style: "align-items:flex-start" }));
  S.push(K.layer(dev({ src: rec("explorer"), at: 5.3, out: 14.0, seek: Math.max(0, (me.rows ?? 6) - 0.6), cap: "sagepays.xyz/explorer · every row is a transaction you can open", right: "live", focus: { x: 50, y: 30, scale: 1.35 } }), { at: 5.2, out: 14.2 }));
  S.push(K.caption("Every payment on this screen was decided by an AI agent. So was every refusal. No human reviewed any of them, and every line links to an on-chain receipt.", 5.8, 14.0));
  // 14–24 · the problem
  S.push(K.layer(`<div class="big" style="font-size:calc(var(--W)*.15)"><span class="t">7–9%</span></div>` + K.words("fees on $20B+ of Caribbean remittances a year · 80–90% of businesses are MSMEs with no credit file", 15.0, { size: 0.03, step: 0.04 }), { at: 14.4, out: 23.8, style: "align-items:flex-start" }));
  S.push(K.caption("In the Caribbean, moving money is expensive, and the businesses that are the economy can't borrow — nothing trustworthy records that they are good for it.", 15.0, 23.6));
  // 24–58 · say the work, in your own money
  S.push(K.layer(`<div class="art" style="${K.anim("pop", 24.2, 0.7, 34.0)}"><div class="art-h"><span>Describe the work · sagepays.xyz/launch</span><span class="real">forms as you type</span></div><p class="art-t" style="font-size:calc(var(--W)*.024);font-weight:500;line-height:1.35">${typeOn(grant, 24.8, 44)}</p><div class="art-f" style="${K.anim("rise", 30.0, 0.6)}"><span>Sage drafts the brief, the criteria and the evidence rule · you set the money</span><b>Draft with Sage →</b></div></div>`, { at: 24.0, out: 34.2, style: "padding:0 18%" }));
  S.push(K.caption("You say the work once, in your own currency. Sage compiles it into milestones, each with a verification contract.", 24.8, 34.0));
  S.push(K.layer(dev({ src: rec("composer-grant"), at: 34.5, out: 48.0, seek: Math.max(0, (mc.priced ?? 60) - 0.8), cap: "the plan, compiled · J$10,000 in two milestones · converted once at a stamped rate", right: "sagepays.xyz/launch", focus: { x: 72, y: 34, scale: 1.55 } }), { at: 34.4, out: 48.2 }));
  S.push(K.caption("It stamps the rate and funds a vault with hard caps. From here it spends without me — and it can never spend outside the vault's limits. The agent proposes; the vault disposes.", 35.0, 48.0));
  S.push(K.layer(K.tiles([{ v: K.count(0, 10000, 48.8, 1.2, { fmt: "jmd" }), k: "the grant, in the seller's money", cls: "ok" }, { v: "2", k: "milestones, each with an evidence rule" }, { v: "14", k: "currencies, Caribbean first" }, { v: "once", k: "converted at a stamped, source-attributed rate" }], 48.6, 0.16, 4), { at: 48.4, out: 57.8, style: "padding:0 6%" }));
  S.push(K.caption("Fourteen currencies. The founder types their number and never does exchange arithmetic.", 49.2, 57.6));
  // 58–72 · the door
  S.push(K.layer(dev({ src: rec("marketplace"), at: 58.2, out: 66.0, seek: Math.max(0, (mm.rows ?? 5) - 0.4), cap: "the marketplace · public work carries the one-person-one-slot mark", right: "sagepays.xyz/marketplace", focus: { x: 50, y: 36, scale: 1.3 } }), { at: 58.0, out: 66.2 }));
  S.push(K.caption("Public work asks everyone to prove they are one person, once. No name, no document, no country — about a minute.", 58.8, 66.0));
  S.push(K.layer(K.words("Fifty slots need fifty t:people.", 66.6, { size: 0.075 }) + K.tiles([{ v: "10", k: "write-ups paid by one gig, in a day", cls: "ok" }, { v: "12", k: "wallets on its graph" }, { v: "1", k: "person per slot, from now on" }], 67.6, 0.14, 3), { at: 66.4, out: 72.0, style: "padding:0 12%" }));
  // 72–110 · paid privately, and the refusal
  S.push(K.layer(dev({ src: rec("receipts"), at: 72.4, out: 88.0, seek: Math.max(0, (mr["b-leg"] ?? 34) - 0.6), cap: "a receipt · the private leg: vault released → escrowed behind a commitment → collected", right: "Starknet mainnet", focus: { x: 50, y: 40, scale: 1.4 } }), { at: 72.2, out: 88.2 }));
  S.push(K.caption("Recipients don't need a bank or a wallet app — chat is the account. Sage verifies the page, pays on Starknet into an escrow only the recipient can open, and publishes a receipt that proves the money moved without saying to whom.", 73.0, 88.0));
  S.push(K.layer(dev({ src: rec("graph"), at: 88.5, out: 98.0, seek: Math.max(0, (mg.scrolled ?? 8) - 0.2), cap: "the wallet graph · wallets that belong together, drawn from the chain", right: "sagepays.xyz/graph", focus: { x: 50, y: 48, scale: 1.3 } }), { at: 88.4, out: 98.2 }));
  S.push(K.caption("And it keeps watch. The wallet graph is drawn from the chain, and a linked cluster is one person's wallets.", 89.1, 98.0));
  S.push(K.layer(`<div class="big" style="font-size:calc(var(--W)*.14)"><span class="t">${K.count(0, L.refused, 98.6, 1.3)}</span></div>` + K.words(`of ${decided} judged decisions were refusals, each with the reason on the record.`, 99.8, { size: 0.036, step: 0.04 }), { at: 98.4, out: 109.8, style: "align-items:flex-start" }));
  S.push(K.caption("And it refuses. That discipline is the product: a rail that pays everything is a leak.", 100.6, 109.6));
  // 110–146 · the credit file and the capital back in
  S.push(K.layer(dev({ src: rec("record"), at: 110.2, out: 124.0, seek: Math.max(0, (mrec.signals ?? 6) - 0.6), cap: "a work record · Sage signals: pass rate, verified inflow, tenure, distinct funders", right: "sagepays.xyz/record", focus: { x: 50, y: 34, scale: 1.35 } }), { at: 110.0, out: 124.2 }));
  S.push(K.caption("Every verified payout accrues to a work record with deterministic credit signals — published formulas over receipts, never a score.", 110.8, 123.8));
  S.push(K.layer(dev({ src: rec("record"), at: 124.5, out: 138.0, seek: Math.max(0, (mrec.capacity ?? 15) - 0.4), cap: "the lender's view · the facility as published arithmetic · the exact call an institution makes", right: "sagepays.xyz/lender", focus: { x: 50, y: 40, scale: 1.35 } }), { at: 124.4, out: 138.2 }));
  S.push(K.caption("And Sage lends against it: an advance sized by the lender's multiple on verified inflow, repaid by the next verified payouts through a waterfall.", 125.1, 138.0));
  S.push(K.layer(K.words("Capital out.", 138.6, { size: 0.09 }) + K.words("Capital back in — from the ledger the agent t:wrote.", 139.5, { size: 0.058, step: 0.05 }), { at: 138.4, out: 145.8 }));
  // 146–168 · the operator
  const goal = mv?.goal ?? "Watch real visitors land on sagepays.xyz and identify exactly where they hesitate or drop off.";
  const reason = mv?.reason ?? "Nothing has been learned on this surface yet, so the first evidence needed is how real people experience the landing page.";
  S.push(K.layer(K.artifact({ head: "Next move · sagepays.xyz", real: mv?.recorded ? "real run" : "rehearsal", title: `<span class="mono">${K.count(0, mv?.budgetBase ? mv.budgetBase / 1e6 : 5, 146.6, 1.0, { fmt: "usd" })}</span> testing run on <span class="mono">sagepays.xyz</span>`, rows: [{ k: "goal", text: goal }, { k: "why", text: reason }], foot: `<span>Sized as if the treasury held <b>$15</b> · nothing recorded until it moves</span><b>let it run →</b>`, at: 146.2, out: 157.0, stagger: 0.45, W }), { at: 146.0, out: 157.2, style: "padding:0 22%" }));
  S.push(K.caption("Fund it once and stop deciding. Sage chooses what work to buy next — where, never how much — proposes it with its reason before a dollar leaves, and you can veto any move.", 146.8, 157.0));
  S.push(K.layer(dev({ src: rec("operator"), at: 157.4, out: 167.6, seek: Math.max(0, (mo.move ?? 30) + 0.3), cap: "the real page · sagepays.xyz/workspace/autopilot", right: "today, at $0", focus: { x: 50, y: 18, scale: 1.6 } }), { at: 157.3, out: 167.8 }));
  S.push(K.caption("The agent picks where to spend. It can never pick how much.", 158.0, 167.4));
  // 168–180 · close
  S.push(K.layer(K.tiles([{ v: "$0.10", k: "flat, per settlement · recipients keep 100%", cls: "ok" }, { v: L.median, k: "median, submit to paid" }, { v: "2", k: "mainnet rails · GOAT + Starknet" }, { v: String(L.people), k: "people paid so far" }], 168.4, 0.14, 4), { at: 168.2, out: 175.0, style: "padding:0 6%" }));
  S.push(K.caption("Fees: a flat ten cents a settlement. Settlement: minutes, verification included. Credit without collateral. Obligations in the region's own currencies.", 168.8, 174.8));
  S.push(K.layer(K.words("Built solo. Live on two mainnet rails. Real t:USDC.", 175.4, { size: 0.058, step: 0.06 }) + K.closeCard(177.0, "sagepays.xyz", "Sage"), { at: 175.2 }));
  return { size: [W, H], duration: 181, html: K.page({ W, H, body: S.join(""), cam: "animation:dolly 181s 0s both linear" }) };
}
