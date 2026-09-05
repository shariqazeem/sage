import * as K from "../kit.mjs";
import { W, H, rec, marksOf } from "./_shared.mjs";
export async function build() {
  const m = marksOf("graph");
  const body = [
    K.layer(K.words("A wallet is t:free.", 0.1, { size: 0.12 }) + K.words("A person is t:not.", 1.0, { size: 0.12 }), { out: 2.6 }),
    K.layer(K.words("One gig. Ten pages published and t:paid.", 2.8, { size: 0.062, step: 0.06 }) + K.tiles([{ v: "10", k: "write-ups verified and paid, one day", cls: "ok" }, { v: "12", k: "wallets drawn on the graph" }, { v: "1", k: "person per slot, from now on" }, { v: "~1 min", k: "to prove it, once" }], 3.6), { at: 2.7, out: 8.0 }),
    K.layer(K.device({ src: rec("graph"), at: 8.3, out: 13.6, seek: (m.graph ?? 5) + 0.2, cap: "the wallet graph · who funded whose gas, whose payouts met — from the chain", right: "sagepays.xyz/graph", ratio: 1, W, focus: { x: 50, y: 48, scale: 1.35 } }), { at: 8.2, out: 13.8 }),
    K.layer(K.words("Prove you are one person. t:Once.", 14.0, { size: 0.09 }) + K.sub("World ID · no name, no document · about a minute · the cap counts the person, not the address", 15.2), { at: 13.9, out: 17.4 }),
    K.layer(K.closeCard(17.7, "sagepays.xyz/verify", "One person, one slot"), { at: 17.6 }),
  ].join("");
  return { size: [W, H], duration: 20.5, html: K.page({ W, H, body, cam: "animation:dolly 20.5s 0s both linear" }) };
}
