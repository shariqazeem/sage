/**
 * Would a GENUINE tester, writing in their own words, actually get paid?
 *
 * The bar is deterministic arithmetic over the private key Sage distilled from its own browsing, so
 * this can be answered exactly — no model, no network, no guessing. Point it at a real inspection's
 * field test and it reports, per account, how many distinct corpus sources the account reaches and
 * whether that clears OBS_BAR.
 *
 *   node scripts/obs-bar-probe.mjs <field-test.json>
 *
 * The file is `{ fieldTest }` as persisted on a job's `result.map`. Accounts below are written the way
 * real testers write: short, narrative, first-person, and NOT in Sage's vocabulary.
 */
import { readFileSync } from "node:fs";
const { distillPrivateKey, verifyAgainstKey, observationBar, OBS_BAR } =
  await import("../src/lib/deputy/observation-verify.ts");

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/obs-bar-probe.mjs <field-test.json>");
  process.exit(1);
}
const { fieldTest } = JSON.parse(readFileSync(path, "utf8"));

// What a tester can read off the public mission card. Anything here is parrot-able and is excluded
// from the key by construction, so the probe must pass it in to be honest.
const PUBLIC = [
  "Verify Campaign Launch URL Input",
  "Confirm that entering a URL and submitting triggers the creation of a campaign flow.",
  "sagepays.xyz",
  "Sage",
  "campaign",
  "launch",
  "product testing",
];

const key = distillPrivateKey(fieldTest, PUBLIC);

const ACCOUNTS = {
  "terse, own words":
    "I went to the launch page and pasted my site url in the box, put a small budget in, hit the button. It started working and showed me it was checking my product.",
  "narrative, own words":
    "Opened the site on my laptop. Clicked through to where you start a campaign. There's a form asking for your product link and how much you want to spend. I filled both in and pressed the button at the bottom. After a moment it moved to a new screen and started showing progress as it looked at my product.",
  "detailed, own words":
    "I started from the homepage and clicked the button to launch. It took me to a dashboard first. From there I went into the campaign flow. The form wanted a product URL and a budget amount. I typed in my link, set the budget, and continued. The next screen showed it inspecting the product and then it produced a set of testing missions with rewards next to each one.",
  "lazy one-liner (should NOT pay)":
    "it works fine, good product",
  "card parrot (should NOT pay)":
    "Confirm that entering a URL and submitting triggers the creation of a campaign flow on sagepays.xyz.",
};

console.log(
  `corpus: ${key.observations.length} observations across ${new Set(key.observations.map((o) => o.source)).size} distinct sources`,
);
console.log(
  `bar: ≥${OBS_BAR.minDistinctMatches} distinct matches, corpus must hold ≥${OBS_BAR.minKeySources} sources\n`,
);

const keySources = new Set(key.observations.map((o) => o.source)).size;
for (const [name, account] of Object.entries(ACCOUNTS)) {
  const match = verifyAgainstKey(account, key);
  const bar = observationBar({
    distinctSources: match.distinctSources,
    keyDistinctSources: keySources,
    vetoFired: false,
    nearDupClear: true,
    hasHighFraud: false,
    matchedCount: match.matchedCount,
    obsConfidence: 0.9,
    rawContradictions: 0,
  });
  console.log(
    `${bar.pass ? "PAY " : "HOLD"}  ${match.distinctSources} distinct / ${match.matchedCount} matches  — ${name}`,
  );
  if (!bar.pass) console.log(`        ${bar.reasons.join(", ")}`);
  if (match.matched.length)
    console.log(
      `        hit: ${match.matched.slice(0, 3).map((m) => `"${m.text.slice(0, 44)}"`).join(" | ")}`,
    );
}
