import { readFileSync } from "node:fs";
const { deriveCriterionEvidence, proveCriteria, verifyAgainstKey, observationBar } =
  await import("../src/lib/deputy/observation-verify.ts");
const { corpus, criteria, evidence } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const key = { observations: corpus, distinctSources: 0, digest: "0x0" };
const keySources = new Set(corpus.map((o) => o.source)).size;
const contract = deriveCriterionEvidence(key, criteria, evidence);

const ACCOUNTS = {
  "the REAL paid submission (matched state:4,28,29,30)":
    "I came in from the opening screen and stepped inside, then walked over to meet Yara. When I got to her she said she felt me arrive and that she tends this place. She asked what brings you here and said there is no wrong answer. I typed that I was carrying a heavy heart, and she answered that whatever I am carrying I can set it down, and that she will listen and she will remember. None of that was on screen before I spoke to her.",
  "genuine tester who quotes ONLY Yara's dialogue (state:28/29)":
    "She asked me what brings you here and told me there is no wrong answer. I said I had a heavy heart. She replied that she will listen and she will remember, and that whatever I am carrying I can set it down.",
};
for (const [name, account] of Object.entries(ACCOUNTS)) {
  const m = verifyAgainstKey(account, key);
  const proof = proveCriteria(account, key, contract, new Set());
  const bar = observationBar({
    distinctSources: m.distinctSources, keyDistinctSources: keySources,
    vetoFired: false, nearDupClear: true, hasHighFraud: false,
    matchedCount: m.matchedCount, obsConfidence: 0.9, rawContradictions: 0,
    unprovenCriteria: proof.missingCriteria, criteriaAllProven: proof.allProven,
    criteriaAdvisory: true, // derived contract → may help, never block
  });
  console.log(`${bar.pass ? "PAY " : "HOLD"}  ${m.distinctSources} distinct  allProven=${proof.allProven}  unproven=[${proof.missingCriteria}]`);
  console.log(`      ${name}`);
  if (!bar.pass) console.log(`      reasons: ${bar.reasons.join(", ")}`);
  console.log(`      matched sources: ${[...new Set(m.matched.map((x) => x.source))].join(",")}`);
}
