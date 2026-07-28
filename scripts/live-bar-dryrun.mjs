/**
 * Would a genuine tester's account clear the bar on a LIVE campaign, before they spend one of their
 * three attempts? Deterministic — the pinned corpus + the same arithmetic the gate runs, no model.
 *
 *   node --import tsx scripts/live-bar-dryrun.mjs <corpus.json>
 */
import { readFileSync } from "node:fs";
const { verifyAgainstKey, observationBar, OBS_BAR } = await import(
  "../src/lib/deputy/observation-verify.ts"
);

const { corpus, accounts } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const key = { observations: corpus };
const keySources = new Set(corpus.map((o) => o.source)).size;

console.log(
  `pinned corpus: ${corpus.length} observations / ${keySources} sources — bar needs ≥${OBS_BAR.minDistinctMatches} matches, ≥${OBS_BAR.minKeySources} sources\n`,
);
for (const [name, text] of Object.entries(accounts)) {
  const m = verifyAgainstKey(text, key);
  const bar = observationBar({
    distinctSources: m.distinctSources,
    keyDistinctSources: keySources,
    vetoFired: false,
    nearDupClear: true,
    hasHighFraud: false,
    matchedCount: m.matchedCount,
    obsConfidence: 0.9,
    rawContradictions: 0,
  });
  console.log(`${bar.pass ? "PAY " : "HOLD"}  ${m.distinctSources} sources / ${m.matchedCount} matches  — ${name}`);
  if (!bar.pass) console.log(`        ${bar.reasons.join(", ")}`);
  if (m.matched.length)
    console.log(`        hit: ${m.matched.slice(0, 4).map((x) => `"${x.text.slice(0, 40)}"`).join(" | ")}`);
}
