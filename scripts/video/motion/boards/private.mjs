import * as K from "../kit.mjs";
import { W, H, rec, marksOf } from "./_shared.mjs";
export async function build() {
  const m = marksOf("receipt");
  const leg = `<div class="art" style="${K.anim("pop", 3.0, 0.7, 9.8)}"><div class="sweep" style="animation:sweep 1.4s 3.9s both cubic-bezier(.4,0,.2,1)"></div>
    <div class="art-h"><span>The private leg · Starknet</span><span class="real">real run</span></div>
    <ul class="leg">
      <li style="${K.anim("rise", 3.4, 0.6)}"><span class="dot"></span><span class="line"></span><div><div class="lt">Vault released</div><div class="lh">0x2b03…49fb · the amount is not an argument the agent can pass</div></div></li>
      <li style="${K.anim("rise", 4.4, 0.6)}"><span class="dot"></span><span class="line"></span><div><div class="lt">Escrowed behind poseidon(secret)</div><div class="lh">0x68eb…8af4 · keyed by a commitment, not a person</div></div></li>
      <li style="${K.anim("rise", 5.4, 0.6)}"><span class="dot"></span><div><div class="lt">Collected by the one-time link</div><div class="lh">commitment 201316…7270 · into a shielded note through the STRK20 pool</div></div></li>
    </ul>
    <div class="art-f" style="${K.anim("rise", 6.4, 0.6)}"><span>The money never lands in the wallet that earned it.</span><span class="pay">receipt →</span></div></div>`;
  const body = [
    K.layer(K.words("Getting paid on-chain means publishing your t:salary.", 0.1, { size: 0.085, step: 0.06 }), { out: 2.8 }),
    K.layer(leg, { at: 2.9, out: 10.0 }),
    K.layer(K.device({ src: rec("receipt"), at: 10.3, out: 15.6, seek: Math.max(0, (m.leg ?? 12) - 0.5), cap: "the receipt · sagepays.xyz/proof/0x2b03…49fb", right: "Starknet mainnet", ratio: 1, W, focus: { x: 50, y: 42, scale: 1.5 } }), { at: 10.2, out: 15.8 }),
    K.layer(K.tiles([{ v: "13", k: "private payouts settled", cls: "ok" }, { v: "3", k: "collected through the pool" }, { v: "1", k: "public receipt, each" }, { v: "0", k: "balances revealed" }], 16.1), { at: 16.0, out: 19.4 }),
    K.layer(K.words("The receipt is public. The balance is t:not.", 19.7, { size: 0.085 }), { at: 19.6, out: 22.4 }),
    K.layer(K.closeCard(22.7, "sagepays.xyz/docs/privacy", "Private on Starknet"), { at: 22.6 }),
  ].join("");
  return { size: [W, H], duration: 25, html: K.page({ W, H, body, cam: "animation:dolly 25s 0s both linear" }) };
}
