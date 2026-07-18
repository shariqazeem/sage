#!/usr/bin/env node
/**
 * P-GEN — the GENERALIZATION BATTERY. Runs the full inspect → field-test → vision → mission-brain →
 * gate → lint pipeline (via the public /api/launch) over one real, live URL per product CATEGORY, and
 * scores a fixed rubric so we can see where the P12–P17 machinery breaks beyond the four products it
 * has met. Standing pre-deploy check: re-run after any inspection/mission change.
 *
 *   node scripts/mission-eval-matrix.mjs [--base https://sagepays.xyz] [--nonce N] [--only category]
 *
 * `--nonce N` varies each URL's budget so a re-run creates FRESH jobs (the launch API dedupes on
 * url+budget+founder). Prints a per-URL line, the category×check grid, failure evidence, and the
 * battery's estimated token cost (vision + brain), with a per-URL cap logged.
 */

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const base = flag("base", "https://sagepays.xyz").replace(/\/+$/, "");
const nonce = Number(flag("nonce", "0")) || 0;
const only = flag("only", "");

// ── THE MATRIX — one real, live, stable public URL per category (documented picks) ──────────────
// expectMode: what the field test SHOULD classify. expectLint: which verifiability class should
// dominate. thin: is a needs_input a CORRECT outcome for this URL (genuinely thin observation)?
// URL picks are documented — and REVISED after the first BEFORE grid exposed bad picks:
//  · spa-app: demo.realworld.io was DEAD (404) → excalidraw.com, a live client-rendered SPA.
//  · non-english: leboncoin.fr hard-403s all bots → about.gitlab.com/fr-fr, a reachable French product.
//  · ecommerce/heavy: allbirds & cnn WAF-challenge our read-only UA (0 static obs) — kept ON PURPOSE as
//    the bot-walled test; `thin:"maybe"` because a graceful needs_input (ask for a demo) is a valid
//    outcome when even the real browser can't anchor a payable mission to a nav-only render.
const MATRIX = [
  { cat: "static-landing", url: "https://motherfuckingwebsite.com", expectMode: "static", expectLint: "url", thin: "maybe" },
  { cat: "docs", url: "https://tailwindcss.com/docs", expectMode: "static", expectLint: "url", thin: false },
  { cat: "saas-marketing", url: "https://plausible.io", expectMode: "static", expectLint: "url", thin: false },
  { cat: "spa-app", url: "https://excalidraw.com", expectMode: "interactive", expectLint: "any", thin: false }, // live CSR SPA
  { cat: "canvas-game", url: "https://play2048.co", expectMode: "interactive", expectLint: "obs", thin: false },
  { cat: "dom-world", url: "https://yara.garden", expectMode: "interactive", expectLint: "obs", thin: false }, // control
  { cat: "ecommerce", url: "https://www.allbirds.com", expectMode: "any", expectLint: "any", thin: "maybe" }, // bot-walled
  { cat: "login-wall", url: "https://web.telegram.org", expectMode: "any", expectLint: "any", thin: "maybe" }, // verification (b)
  { cat: "portfolio", url: "https://brittanychiang.com", expectMode: "static", expectLint: "url", thin: "maybe" },
  { cat: "non-english", url: "https://about.gitlab.com/fr-fr/", expectMode: "any", expectLint: "any", thin: false }, // verification (c)
  { cat: "heavy-slow", url: "https://www.cnn.com", expectMode: "any", expectLint: "any", thin: "maybe" }, // bot-walled
];

const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
const EST_TOKENS_PER_IMAGE = 1370; // measured on the yara run (8206/6)
const EST_BRAIN_TOKENS = 15000; // architect + critic per inspection (rough)
const PER_URL_CAP_TOKENS = 60000; // budget guard: log if a URL exceeds this

// Rebuild a best-effort observation corpus from the returned map (mirrors buildObservationCorpus over
// what the API exposes) — to independently re-check that accepted anchors were really observed.
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

async function runOne(m, i) {
  const budget = 10 + i + nonce * 100;
  let job;
  try {
    const res = await fetch(`${base}/api/launch`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ productUrl: m.url, budgetUsd: budget, goal: "Validate the core experience for a first-time user", targetUsers: "First-time visitors" }),
    });
    const j = await res.json();
    if (!j.ok) return { ...m, error: `launch: ${j.error}` };
    const id = j.job.id;
    for (let t = 0; t < 30; t++) {
      const p = await (await fetch(`${base}/api/launch/${id}`)).json();
      job = p.job;
      if (["ready", "needs_input", "failed"].includes(job?.status)) break;
      await new Promise((r) => setTimeout(r, 10_000));
    }
  } catch (e) {
    return { ...m, error: String(e?.message || e).slice(0, 80) };
  }
  if (!job) return { ...m, error: "timeout" };

  const map = job.result?.map;
  const ft = map?.fieldTest;
  const plan = job.plan;
  const missions = plan?.missions || [];
  const corpus = rebuildCorpus(map);

  // anchor integrity: every accepted mission's anchors present in the observed corpus
  let anchored = 0;
  for (const mm of missions) {
    const a = (mm.anchors || []).map(norm).filter((x) => x.length >= 3);
    if (a.length > 0 && a.every((x) => corpus.includes(x))) anchored++;
  }
  const integrity = missions.length ? Math.round((anchored / missions.length) * 100) : 100;
  const urlV = missions.filter((x) => x.verifiabilityClass === "url-verifiable").length;
  const obsV = missions.filter((x) => x.verifiabilityClass === "observation-based").length;
  const visionN = ft?.visionObservations?.length ?? 0;
  const estTokens = visionN * EST_TOKENS_PER_IMAGE + (job.status === "needs_input" ? EST_BRAIN_TOKENS / 2 : EST_BRAIN_TOKENS);

  // ── rubric checks ──
  const mode = ft?.mode ?? (ft ? "?" : "static(no-ft)");
  const isInteractive = mode === "interactive";
  const junkJourney = (map?.primaryJourney || []).some((j) => / — [^a-z0-9]{0,2}$/i.test(j.value || ""));
  const checks = {
    mode: m.expectMode === "any" ? "n/a" : (ft ? (mode === m.expectMode ? "PASS" : `FAIL(${mode})`) : "n/a"),
    states: !isInteractive ? "n/a" : ((ft?.states?.length ?? 0) > 1 ? "PASS" : `FAIL(${ft?.states?.length ?? 0})`),
    loadingWaited: !isInteractive ? "n/a" : ((ft?.states || []).some((s) => /waited out loading/i.test(s.trigger)) ? "PASS" : "—"),
    category: job.status === "needs_input" ? "n/a" : (map?.category && map.category !== "product (uncategorized)" && !junkJourney ? "PASS" : `FAIL(${map?.category}${junkJourney ? "+junkJourney" : ""})`),
    anchorInteg: missions.length === 0 ? "n/a" : (integrity === 100 ? "PASS" : `FAIL(${integrity}%)`),
    lintSplit: missions.length === 0 ? "n/a" : (m.expectLint === "any" ? "PASS" : m.expectLint === "url" ? (urlV > 0 ? "PASS" : `FAIL(0url/${obsV}obs)`) : (obsV > 0 ? "PASS" : `FAIL(${urlV}url/0obs)`)),
    needsInput: job.status !== "needs_input" ? (m.thin === true ? "FAIL(should-ask)" : "PASS") : (m.thin === false ? "FAIL(false-fire)" : "PASS"),
  };
  return { ...m, status: job.status, mode, statesN: ft?.states?.length ?? 0, visionN, category: map?.category, name: map?.productName, missions: missions.length, urlV, obsV, integrity, estTokens, checks, questions: job.result?.questions || [] };
}

// ── run the battery (light concurrency; the prod server + LLM quota bound it) ──
const rows = MATRIX.filter((m) => !only || m.cat === only);
console.log(`P-GEN battery · base ${base} · nonce ${nonce} · ${rows.length} URLs\n${"═".repeat(90)}`);
const results = [];
for (const [i, m] of rows.entries()) {
  process.stdout.write(`[${i + 1}/${rows.length}] ${m.cat.padEnd(16)} ${m.url} … `);
  const r = await runOne(m, i);
  results.push(r);
  if (r.error) { console.log(`ERROR: ${r.error}`); continue; }
  console.log(`${r.status} · mode ${r.mode} · states ${r.statesN} · vision ${r.visionN} · ${r.missions} missions (${r.urlV}url/${r.obsV}obs) · anchors ${r.integrity}% · ~${Math.round(r.estTokens / 1000)}k tok`);
  console.log(`      cat="${r.category}" name="${r.name}"${r.questions.length ? ` · Q: ${r.questions[0].slice(0, 80)}` : ""}`);
}

// ── the grid ──
const CHECKS = ["mode", "states", "loadingWaited", "category", "anchorInteg", "lintSplit", "needsInput"];
console.log(`\n${"═".repeat(90)}\nGRID (category × check)\n`);
console.log(["category".padEnd(16), ...CHECKS.map((c) => c.slice(0, 9).padEnd(10))].join(""));
for (const r of results) {
  if (r.error) { console.log(`${r.cat.padEnd(16)}ERROR: ${r.error}`); continue; }
  console.log([r.cat.padEnd(16), ...CHECKS.map((c) => String(r.checks[c] ?? "—").slice(0, 9).padEnd(10))].join(""));
}

// ── failures + cost ──
console.log(`\n${"═".repeat(90)}\nFAILURES (evidence):`);
let anyFail = false;
for (const r of results) {
  if (r.error) { anyFail = true; console.log(`  ✗ ${r.cat}: ${r.error}`); continue; }
  for (const c of CHECKS) if (String(r.checks[c]).startsWith("FAIL")) { anyFail = true; console.log(`  ✗ ${r.cat}/${c}: ${r.checks[c]} — cat="${r.category}" name="${r.name}" states=${r.statesN} lint=${r.urlV}url/${r.obsV}obs`); }
}
if (!anyFail) console.log("  (none)");

const total = results.reduce((s, r) => s + (r.estTokens || 0), 0);
const over = results.filter((r) => (r.estTokens || 0) > PER_URL_CAP_TOKENS);
console.log(`\n${"═".repeat(90)}\nCOST (estimated tokens): total ~${Math.round(total / 1000)}k across ${results.length} URLs · avg ~${Math.round(total / 1000 / Math.max(1, results.length))}k/URL`);
if (over.length) console.log(`  ⚠ over per-URL cap (${PER_URL_CAP_TOKENS / 1000}k): ${over.map((r) => `${r.cat}(~${Math.round(r.estTokens / 1000)}k)`).join(", ")}`);
