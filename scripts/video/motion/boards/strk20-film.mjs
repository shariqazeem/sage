/** THE STRK20 FILM — privacy that works for work, 16:9, under three minutes. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as K from "../kit.mjs";
import { ledger } from "../data.mjs";
import { typeOn } from "./_shared.mjs";
const W = 1920, H = 1080;
const rec = (n) => `file://${resolve(`docs/posts/videos/rec/film/${n}.webm`)}`;
const marks = (n) => JSON.parse(readFileSync(`docs/posts/videos/rec/film/${n}.marks.json`, "utf8")).marks;
const dev = (o) => K.device({ ratio: 16 / 9, W, width: 0.6, ...o });
export async function build() {
  const L = await ledger();
  const me = marks("explorer"), mr = marks("receipts"), mg = marks("graph"), mc = marks("composer-grant");
  const S = [];
  S.push(K.layer(K.words("Getting paid on-chain means publishing your t:salary.", 0.3, { size: 0.07, step: 0.06 }), { out: 5.6 }));
  S.push(K.caption("Every payout writes a permanent, searchable line: this address earned this much, from this person, on this day. For a freelancer in a small market that is not transparency. It is their income, public, forever.", 1.0, 11.0));
  S.push(K.layer(dev({ src: rec("explorer"), at: 5.9, out: 16.0, seek: Math.max(0, (me.rows ?? 6) - 0.4), cap: "sagepays.xyz/explorer · every settlement, both rails", right: "live", focus: { x: 50, y: 30, scale: 1.35 } }), { at: 5.8, out: 16.2 }));
  S.push(K.caption(`Sage is an AI agent that checks someone's work and pays them for it. ${L.payouts} verified payouts on two mainnet rails, ${L.refused} refusals with the reason on record.`, 11.3, 16.0));
  S.push(K.layer(K.words("So we rebuilt how Sage t:pays.", 16.5, { size: 0.085 }), { at: 16.4, out: 20.6 }));
  S.push(K.layer(`<div class="art" style="${K.anim("pop", 21.0, 0.7, 40.0)}"><div class="art-h"><span>The private leg · Starknet mainnet</span><span class="real">real run</span></div><ul class="leg"><li style="${K.anim("rise", 21.6, 0.6)}"><span class="dot"></span><span class="line"></span><div><div class="lt">Vault released</div><div class="lh">0x2b03…49fb · a Cairo vault looks the reward up from the mission — the amount is not an argument the agent can pass</div></div></li><li style="${K.anim("rise", 24.2, 0.6)}"><span class="dot"></span><span class="line"></span><div><div class="lt">Escrowed behind poseidon(secret)</div><div class="lh">0x68eb…8af4 · keyed by a commitment, not a person</div></div></li><li style="${K.anim("rise", 27.0, 0.6)}"><span class="dot"></span><div><div class="lt">Collected by the one-time link</div><div class="lh">commitment 201316…7270 · into a shielded note through the STRK20 pool</div></div></li></ul><div class="art-f" style="${K.anim("rise", 30.0, 0.6)}"><span>The money never lands in the wallet that earned it.</span><span class="pay">receipt →</span></div></div>`, { at: 20.9, out: 40.2, style: "padding:0 22%" }));
  S.push(K.caption("The payout happens in two halves. A Cairo vault releases the reward, bounded by rules the agent cannot exceed — the amount isn't even an argument it can pass.", 21.4, 30.0));
  S.push(K.caption("Sage escrows that money against a Poseidon commitment. The worker collects it with a one-time link — including into a shielded note, where the amount is attributable to nobody.", 30.3, 40.0));
  S.push(K.layer(dev({ src: rec("receipts"), at: 40.5, out: 56.0, seek: Math.max(0, (mr["b-leg"] ?? 34) - 0.6), cap: "the receipt · sagepays.xyz/proof/0x2b03…49fb · the private leg drawn", right: "Starknet mainnet", focus: { x: 50, y: 40, scale: 1.4 } }), { at: 40.4, out: 56.2 }));
  S.push(K.caption("The receipt is public: the vault, the escrow, the collection. Who collected it is not on this ledger.", 41.0, 56.0));
  S.push(K.layer(K.tiles([{ v: "13", k: "private payouts settled", cls: "ok" }, { v: "3", k: "collected through the STRK20 pool" }, { v: "2", k: "Cairo contracts · SageVault + SageClaims" }, { v: "4", k: "mainnet transactions in strk20.json" }], 56.6, 0.16, 4), { at: 56.4, out: 66.0, style: "padding:0 6%" }));
  S.push(K.caption("SageClaims integrates the STRK20 pool directly. Every hash is in the manifest; every contract is on Voyager.", 57.2, 66.0));
  S.push(K.layer(`<div class="art" style="${K.anim("pop", 66.4, 0.7, 78.0)}"><div class="art-h"><span>Describe the work · sagepays.xyz/launch</span><span class="real">forms as you type</span></div><p class="art-t" style="font-size:calc(var(--W)*.024);font-weight:500;line-height:1.35">${typeOn("Give a market seller J$10,000 in two equal parts — half when her catalogue page is online with her wallet address on it, half when she posts her first customer review.", 67.0, 40)}</p></div>`, { at: 66.2, out: 78.2, style: "padding:0 18%" }));
  S.push(K.caption("A founder says the work once. Sage compiles it into milestones with a verification contract, and the rail is a choice: private on Starknet when you ask.", 67.2, 78.0));
  S.push(K.layer(dev({ src: rec("composer-grant"), at: 78.5, out: 92.0, seek: Math.max(0, (mc.priced ?? 60) - 0.8), cap: "the plan, compiled · J$10,000 in two milestones", right: "sagepays.xyz/launch", focus: { x: 72, y: 34, scale: 1.55 } }), { at: 78.4, out: 92.2 }));
  S.push(K.caption("A worker submits. Sage judges the evidence itself and the vault releases the reward — no human in the loop.", 79.2, 92.0));
  S.push(K.layer(dev({ src: rec("graph"), at: 92.5, out: 106.0, seek: Math.max(0, (mg.scrolled ?? 8) - 0.2), cap: "the wallet graph · wallets that belong together, drawn from the chain", right: "sagepays.xyz/graph", focus: { x: 50, y: 48, scale: 1.3 } }), { at: 92.4, out: 106.2 }));
  S.push(K.caption("Privacy without accountability is a farm. The wallet graph links wallets that belong together, and public work asks for one proof of personhood, once — the cap counts the person, not the address.", 93.2, 106.0));
  S.push(K.layer(K.words("Auditable in aggregate.", 106.6, { size: 0.08 }) + K.words("Private in the t:destination.", 107.5, { size: 0.08 }), { at: 106.4, out: 114.0 }));
  S.push(K.layer(K.closeCard(114.4, "sagepays.xyz · strk20.json · SageVault · SageClaims", "Sage on Starknet"), { at: 114.2 }));
  return { size: [W, H], duration: 119, html: K.page({ W, H, body: S.join(""), cam: "animation:dolly 119s 0s both linear" }) };
}
