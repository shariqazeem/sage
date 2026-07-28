import { readFileSync } from "node:fs";
const { distillPrivateKey } = await import("../src/lib/deputy/observation-verify.ts");
const { fieldTest } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const key = distillPrivateKey(fieldTest, ["Verify Campaign Launch URL Input","sagepays.xyz","Sage","campaign","launch"]);
const by = {};
for (const o of key.observations) (by[o.source] ||= []).push(o.text);
const states = fieldTest.states || [];
for (const [src, obs] of Object.entries(by)) {
  const i = Number(src.split(":")[1]);
  const st = states[i];
  console.log(`${src.padEnd(10)} n=${String(obs.length).padStart(3)}  [${st?.actionKind ?? "?"}] ${(st?.trigger ?? "").slice(0,42)}`);
  console.log(`           e.g. ${obs.slice(0,2).map(t=>`"${t.slice(0,48)}"`).join(" | ")}`);
}
