import * as K from "../kit.mjs";
import { ledger, explorerRows } from "../data.mjs";
import { W, H, rec, marksOf } from "./_shared.mjs";
export async function build() {
  const L = await ledger();
  const rows = (await explorerRows("https://sagepays.xyz", 7)).map((r) => ({ ...r }));
  const decided = L.payouts + L.refused;
  const m = marksOf("explorer");
  const rowsHtml = `<div class="rows">${rows.map((r, i) => `<div class="row" style="${K.anim("rise", 5.5 + i * 0.16, 0.55)}"><span class="st ${r.ok ? "ok" : "no"}">${r.ok ? "✓" : "✕"}</span><span>${r.ok ? "paid to" : "refused"} ${r.wallet}</span><span class="rail">· ${r.rail}</span><span class="amt ${r.ok ? "ok" : "no"}">${r.ok ? "paid" : "held"}</span></div>`).join("")}</div>`;
  const body = [
    K.layer(`<div class="big"><span class="t">${K.count(0, L.refused, 0.2, 1.5)}</span></div>` + K.words(`of the last ${decided} decisions our agent made about money were t:refusals.`, 1.5, { size: 0.062, step: 0.05 }), { out: 5.2 }),
    K.layer(rowsHtml, { at: 5.3, out: 10.6 }),
    K.layer(K.device({ src: rec("explorer"), at: 10.9, out: 15.8, seek: (m.rows ?? 6) - 0.4, cap: "the explorer · every row is a transaction you can open", right: "sagepays.xyz/explorer", ratio: 1, W, focus: { x: 50, y: 34, scale: 1.45 } }), { at: 10.8, out: 16.0 }),
    K.layer(K.tiles([{ v: `$${L.paidUsd.toFixed(2)}`, k: "settled, verified" }, { v: String(L.payouts), k: "mainnet payouts", cls: "ok" }, { v: String(L.refused), k: "refusals on record", cls: "no" }, { v: `${Math.round((L.refused / decided) * 100)}%`, k: "refusal share" }], 16.3), { at: 16.2, out: 19.8 }),
    K.layer(K.words("An agent that never says no is a t:faucet.", 20.1, { size: 0.09 }), { at: 20.0, out: 22.8 }),
    K.layer(K.closeCard(23.1, "sagepays.xyz/explorer", "Every decision, on record"), { at: 23.0 }),
  ].join("");
  return { size: [W, H], duration: 25.5, html: K.page({ W, H, body, cam: "animation:dolly 25.5s 0s both linear" }) };
}
