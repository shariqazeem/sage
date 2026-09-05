import { readFileSync } from "node:fs";
import * as K from "../kit.mjs";
import { operatorMove } from "../data.mjs";
import { W, H, rec, marksOf } from "./_shared.mjs";
export async function build() {
  const key = readFileSync(process.env.RECORD_KEY_FILE ?? "/private/tmp/claude-501/-Users-macbookair-projects-SAGE/2916cf8f-4f37-4010-95d9-25206656196f/scratchpad/record-key.txt", "utf8").split(/\s+/)[0];
  const mv = await operatorMove(key);
  const goal = mv.goal ?? "Have real first-time visitors land on sagepays.xyz and report where they hesitate, drop off, or get confused.";
  const reason = mv.reason ?? "No prior work on this surface: the first learning must come from real users hitting the page.";
  const budget = mv.budgetUsd != null ? Number(mv.budgetUsd) : mv.budgetBase != null ? Number(mv.budgetBase) / 1e6 : 5;
  const m = marksOf("operator");
  const body = [
    K.layer(K.words("Fund it t:once.", 0.1, { size: 0.11 }) + K.words("Sage decides t:where.", 0.9, { size: 0.11 }), { out: 2.5 }),
    K.layer(K.artifact({
      head: "Next move · sagepays.xyz", real: mv.recorded || mv.source === "real" ? "real run" : "rehearsal",
      title: `<span class="mono">${K.count(0, budget, 3.0, 1.1, { fmt: "usd" })}</span> testing run on <span class="mono">sagepays.xyz</span>`,
      rows: [{ k: "goal", text: goal }, { k: "why", text: reason }],
      foot: `<span>Sized as if the treasury held <b>$15</b> · nothing recorded</span><b>let it run →</b>`,
      at: 2.7, out: 9.4, stagger: 0.5,
    }), { at: 2.6, out: 9.6 }),
    K.layer(K.device({ src: rec("operator"), at: 9.8, out: 15.0, seek: (m.move ?? 30) + 0.4, cap: "the real page · sagepays.xyz/workspace/autopilot", right: "today, at $0", ratio: 1, W, focus: { x: 50, y: 16, scale: 1.75 } }), { at: 9.7, out: 15.2 }),
    K.layer(K.words("Proposed before a dollar leaves.", 15.4, { size: 0.085 }) + K.sub("never above your ceilings · never its own prices · never a product you did not name", 16.4), { at: 15.3, out: 18.2 }),
    K.layer(K.closeCard(18.5, "sagepays.xyz/docs/operator", "The operator"), { at: 18.4 }),
  ].join("");
  return { size: [W, H], duration: 21, html: K.page({ W, H, body, cam: "animation:dolly 21s 0s both linear" }) };
}
