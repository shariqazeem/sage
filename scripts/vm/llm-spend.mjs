/**
 * WHAT SAGE'S BRAIN COST, PER DAY, PER ACCOUNT, PER LANE (6 Nov 2026).
 *
 *   node scripts/vm/llm-spend.mjs            the last 7 days
 *   node scripts/vm/llm-spend.mjs 30         the last 30 days
 *
 * Reads the book the wire keeps (var/llm-spend.json, src/lib/llm/spend.ts): every answer priced from its
 * own `usage`, an unknown model over-counted. Prints hosts and key ids only, never a key. With
 * LLM_DAILY_BUDGET_USD set, it shows how much of today's ceiling is used.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const days = Math.max(1, Number(process.argv[2]) || 7);
const path = process.env.LLM_SPEND_PATH || join(process.cwd(), "var", "llm-spend.json");
if (!existsSync(path)) {
  console.log(`no spend recorded yet (${path})`);
  process.exit(0);
}
const book = JSON.parse(readFileSync(path, "utf8")).days ?? {};
const usd = (micro) => `$${(micro / 1e6).toFixed(3)}`;

let envBudget = null;
try {
  const env = readFileSync(join(process.cwd(), ".env"), "utf8");
  const m = /^\s*LLM_DAILY_BUDGET_USD\s*=\s*["']?([0-9.]+)/m.exec(env);
  if (m) envBudget = Number(m[1]);
} catch {
  /* no .env here */
}

let total = 0;
for (const day of Object.keys(book).sort().slice(-days)) {
  const accounts = Object.entries(book[day]);
  const dayTotal = accounts.reduce((s, [, a]) => s + a.usdMicro, 0);
  total += dayTotal;
  console.log(`\n${day}  ${usd(dayTotal)}`);
  for (const [id, a] of accounts) {
    const used = envBudget ? `  (${Math.round((a.usdMicro / (envBudget * 1e6)) * 100)}% of the $${envBudget} budget)` : "";
    console.log(`  ${a.host} [${id.split("|")[1] ?? "?"}]  ${usd(a.usdMicro)} in ${a.calls} calls${used}`);
    const lanes = Object.entries(a.lanes).sort((x, y) => y[1].usdMicro - x[1].usdMicro);
    for (const [lane, b] of lanes) console.log(`    ${lane.padEnd(12)} ${usd(b.usdMicro).padStart(8)}  ${b.calls} calls`);
  }
}
console.log(`\ntotal ${usd(total)} over ${Math.min(days, Object.keys(book).length)} day(s)`);
