import * as K from "../kit.mjs";
import { recordSignals } from "../data.mjs";
import { W, H, rec, marksOf } from "./_shared.mjs";
export async function build() {
  const s = await recordSignals("0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3");
  const m = marksOf("lender");
  const body = [
    K.layer(K.words("80 to 90% of Caribbean businesses are t:MSMEs.", 0.1, { size: 0.08, step: 0.06 }) + K.words("Lending is collateral-based because there is no t:record.", 1.6, { size: 0.062, step: 0.05 }), { out: 5.0 }),
    K.layer(K.words("Every verified payout t:writes one.", 5.2, { size: 0.062 }) + K.tiles([{ v: s.inflow ?? "$2.00", k: "verified inflow, 90d", cls: "ok" }, { v: s.passRate ?? "60%", k: "verification pass rate" }, { v: s.funderShare ?? "75%", k: "largest funder share" }, { v: s.lastPaid ?? "36d", k: "since last payout" }], 5.8), { at: 5.1, out: 10.9 }),
    K.layer(K.device({ src: rec("lender"), at: 11.2, out: 16.4, seek: Math.max(0, (m.call ?? 12) - 0.6), cap: "the lender's view · one call returns the record as JSON", right: "sagepays.xyz/lender", ratio: 1, W, focus: { x: 50, y: 30, scale: 1.45 } }), { at: 11.1, out: 16.6 }),
    K.layer(K.words("An advance from verified inflow.", 16.9, { size: 0.08 }) + K.words("Repaid by the next t:payout.", 17.8, { size: 0.08 }) + K.sub("formulas over receipts · never a score · both rails", 18.9), { at: 16.8, out: 21.2 }),
    K.layer(K.closeCard(21.5, "sagepays.xyz/lender", "For lenders"), { at: 21.4 }),
  ].join("");
  return { size: [W, H], duration: 24, html: K.page({ W, H, body, cam: "animation:dolly 24s 0s both linear" }) };
}
