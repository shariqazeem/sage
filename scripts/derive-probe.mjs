import { readFileSync } from "node:fs";
const { deriveCriterionEvidence } = await import("../src/lib/deputy/observation-verify.ts");
const { corpus, criteria, evidence } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const key = { observations: corpus, distinctSources: 0, digest: "0x0" };
const allSources = new Set(corpus.map((o) => o.source)).size;
console.log(`corpus: ${corpus.length} observations / ${allSources} distinct sources\n`);
const derived = deriveCriterionEvidence(key, criteria, evidence);
for (const d of derived) {
  const pct = allSources ? Math.round((d.keySources.length / allSources) * 100) : 0;
  console.log(`criterion ${d.criterionIndex}: ${d.keySources.length}/${allSources} sources (${pct}%)  ${d.keySources.join(",") || "— UNPROVABLE"}`);
  console.log(`   "${String(criteria[d.criterionIndex]).slice(0, 96)}"`);
}
const provable = derived.filter((d) => d.keySources.length > 0);
console.log(`\nprovable criteria: ${provable.length}/${derived.length}`);
const avg = provable.length ? provable.reduce((a, d) => a + d.keySources.length, 0) / provable.length : 0;
console.log(`avg slice width: ${avg.toFixed(1)}/${allSources} sources — narrow slices = harder to fake`);
