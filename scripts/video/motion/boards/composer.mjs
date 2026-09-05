import * as K from "../kit.mjs";
import { W, H, rec, marksOf, typeOn } from "./_shared.mjs";
export async function build() {
  const m = marksOf("composer");
  const sentence = "Pay J$800 to each of 8 people who publish a post of at least 250 words about how they get paid for remote work in the Caribbean today, with their wallet address on the page. One per person.";
  const card = `<div class="art" style="${K.anim("pop", 2.8, 0.7, 10.2)}"><div class="art-h"><span>Describe the work · sagepays.xyz/launch</span><span class="real">forms as you type</span></div>
    <p class="art-t" style="font-size:calc(var(--W)*.03);font-weight:500;line-height:1.35">${typeOn(sentence, 3.2, 40)}</p>
    <div class="art-f" style="${K.anim("rise", 8.6, 0.6)}"><span>Sage drafts the brief, the criteria and the evidence rule</span><b>Draft with Sage →</b></div></div>`;
  const body = [
    K.layer(K.words("Say the work.", 0.1, { size: 0.11 }) + K.words("In your own t:money.", 0.9, { size: 0.11 }), { out: 2.6 }),
    K.layer(card, { at: 2.7, out: 10.4 }),
    K.layer(K.device({ src: rec("composer"), at: 10.7, out: 16.0, seek: Math.max(0, (m.priced ?? 40) - 1.2), cap: "the plan, compiled · you set the money, no model ever does", right: "sagepays.xyz/launch", ratio: 1, W, focus: { x: 74, y: 30, scale: 1.6 } }), { at: 10.6, out: 16.2 }),
    K.layer(K.tiles([{ v: K.count(0, 800, 16.6, 1.2, { fmt: "jmd" }), k: "to each person", cls: "ok" }, { v: "8", k: "people, one slot each" }, { v: "250", k: "word floor, checked before any model reads it" }, { v: "once", k: "converted at a stamped rate" }], 16.5), { at: 16.4, out: 20.0 }),
    K.layer(K.words("The agent drafts. The vault t:pays.", 20.3, { size: 0.095 }), { at: 20.2, out: 22.9 }),
    K.layer(K.closeCard(23.2, "sagepays.xyz/launch", "Gigs · bounties · grants"), { at: 23.1 }),
  ].join("");
  return { size: [W, H], duration: 25.5, html: K.page({ W, H, body, cam: "animation:dolly 25.5s 0s both linear" }) };
}
