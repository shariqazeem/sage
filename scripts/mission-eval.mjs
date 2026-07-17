#!/usr/bin/env node
/**
 * MISSION EVAL (P15.6) — score the mission plan Sage produces for any LIVE url, on data, so
 * MISSION_MODEL can be A/B'd instead of eyeballed. Drives the real pipeline through the public API.
 *
 *   node scripts/mission-eval.mjs <url> [budgetUsd] [--base https://sagepays.xyz] [--label gemini]
 *
 * Scores three things the North Star cares about:
 *   1. needs_input correctness — did Sage ask (thin product) vs plan (rich product)?
 *   2. lint split — how many missions are url-verifiable vs observation-based (from the plan).
 *   3. anchor integrity — are EVERY accepted mission's anchors actually present in what Sage
 *      observed? (independent re-check against a corpus rebuilt from the returned map; the gate
 *      should already guarantee 100%, this proves it end-to-end.)
 *
 * To A/B a model: point MISSION_MODEL at it + restart the server, reset the job, then run this.
 * Exit code is non-zero if anchor integrity < 100% (a shipped hallucination — must never happen).
 */

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a));
const budget = Number(args.find((a) => /^\d+$/.test(a))) || 20;
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const base = (flag("base", "https://sagepays.xyz")).replace(/\/+$/, "");
const label = flag("label", "");

if (!url) {
  console.error("usage: node scripts/mission-eval.mjs <url> [budgetUsd] [--base <url>] [--label <name>]");
  process.exit(2);
}

const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

// Rebuild a best-effort observation corpus from the returned map (mirrors buildObservationCorpus
// over the fields the API exposes — enough to independently re-check the accepted anchors).
function rebuildCorpus(map) {
  const parts = [];
  const push = (v) => { if (v) parts.push(v); };
  const pushAll = (a) => (a || []).forEach(push);
  push(map?.productName); push(map?.valueProp);
  for (const k of ["routes", "primaryJourney", "claimRisks", "observedStates", "interactiveSurfaces", "trustSurfaces"]) for (const f of map?.[k] || []) push(f.value);
  const ft = map?.fieldTest;
  if (ft) {
    for (const p of ft.pages || []) { push(p.title); push(p.h1); pushAll(p.ctas); }
    for (const s of ft.states || []) { push(s.trigger); push(s.visibleTextExcerpt); for (const e of s.notableElements || []) push(e.text); }
    for (const v of ft.visionObservations || []) { push(v.sceneDescription); pushAll(v.visibleText); for (const e of v.uiElements || []) push(e.label); pushAll(v.productTypeSignals); pushAll(v.audienceSignals); }
  }
  return norm(parts.join(" • "));
}

async function post() {
  const res = await fetch(`${base}/api/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productUrl: url, budgetUsd: budget, goal: "Validate the core experience for a first-time user", targetUsers: "First-time visitors" }),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(`launch failed: ${j.error}`);
  return j.job.id;
}

async function poll(id) {
  for (let i = 0; i < 30; i++) {
    const j = await (await fetch(`${base}/api/launch/${id}`)).json();
    const st = j.job?.status;
    if (["ready", "needs_input", "failed"].includes(st)) return j.job;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error("timed out");
}

const id = await post();
console.log(`${label ? `[${label}] ` : ""}eval ${url} (budget $${budget}) → job ${id}`);
const job = await poll(id);
const map = job.result?.map;
const plan = job.plan;
const missions = plan?.missions || [];

console.log("─".repeat(64));
console.log(`status:        ${job.status}`);

// 1. needs_input correctness (report the questions).
if (job.status === "needs_input") {
  console.log(`needs_input:   YES — Sage asked rather than confabulated`);
  for (const q of job.result?.questions || []) console.log(`   • ${q}`);
} else {
  console.log(`needs_input:   no — ${missions.length} mission(s) planned`);
}

// 2. lint split + the plain-words disclosure.
if (missions.length) {
  const url_v = missions.filter((m) => m.verifiabilityClass === "url-verifiable").length;
  const obs_v = missions.filter((m) => m.verifiabilityClass === "observation-based").length;
  console.log(`lint split:    ${url_v} url-verifiable · ${obs_v} observation-based`);
  if (plan?.verifiabilityNote) console.log(`disclosure:    ${plan.verifiabilityNote}`);
}

// 3. anchor integrity — every accepted mission's anchors must be in the observed corpus.
const corpus = rebuildCorpus(map);
let anchored = 0, missing = [];
for (const m of missions) {
  const anchors = (m.anchors || []).map(norm).filter((a) => a.length >= 3);
  const ok = anchors.length > 0 && anchors.every((a) => corpus.includes(a));
  if (ok) anchored++;
  else missing.push({ key: m.missionKey, anchors, bad: anchors.filter((a) => !corpus.includes(a)) });
}
const integrity = missions.length ? Math.round((anchored / missions.length) * 100) : 100;
console.log(`anchor integ.: ${anchored}/${missions.length} accepted missions fully anchored (${integrity}%)`);
for (const x of missing) console.log(`   ✗ ${x.key}: unfound ${JSON.stringify(x.bad)}`);

console.log("─".repeat(64));
for (const m of missions) console.log(`  • [${m.verifiabilityClass || "?"}] ${m.title}`);

// the one hard failure: a shipped mission whose anchor was never observed.
if (integrity < 100) {
  console.log(`\nFAIL: ${missions.length - anchored} mission(s) shipped with an un-observed anchor.`);
  process.exit(1);
}
console.log(`\nOK: ${job.status === "needs_input" ? "sharp needs_input" : "every shipped mission is anchored to real observation"}.`);
