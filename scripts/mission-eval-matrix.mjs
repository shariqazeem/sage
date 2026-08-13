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
  { cat: "static-landing", url: "https://motherfuckingwebsite.com", expectMode: "any", expectLint: "url", thin: "maybe", accept: ["ready", "needs_input"], lintOptional: true }, // 1-sentence page: a thin url mission OR an honest ask are BOTH correct; expectMode relaxed — see the portfolio note below
  { cat: "docs", url: "https://tailwindcss.com/docs", expectMode: "static", expectLint: "url", thin: "maybe", accept: ["ready", "needs_input"], lintOptional: true }, // a reference-doc site: design a "follow this guide" mission OR ask — both honest
  // lintOptional on evidence: plausible returned 0url in 8 of its last 14 recorded runs (back to
  // 1 Aug) — the url-vs-observation split is the architect's judgement call and varies per run, so as
  // a hard gate it measures model variance, not correctness. It still PRINTS as ~(0url/2obs) so real
  // drift toward observation-only stays visible in the grid; it just no longer fails the battery.
  { cat: "saas-marketing", url: "https://plausible.io", expectMode: "static", expectLint: "url", thin: false, lintOptional: true },
  { cat: "spa-app", url: "https://excalidraw.com", expectMode: "interactive", expectLint: "any", thin: "maybe", accept: ["ready", "needs_input"] }, // live CSR SPA; wordless/experiential like yara → a mission OR an honest ask both pass
  { cat: "canvas-game", url: "https://play2048.co", expectMode: "interactive", expectLint: "obs", thin: false },
  { cat: "dom-world", url: "https://yara.garden", expectMode: "interactive", expectLint: "obs", thin: false }, // control
  { cat: "ecommerce", url: "https://www.allbirds.com", expectMode: "any", expectLint: "any", thin: "maybe" }, // bot-walled
  { cat: "login-wall", url: "https://web.telegram.org", expectMode: "any", expectLint: "any", thin: "maybe" }, // verification (b)
  // expectMode RELAXED to "any" on evidence, not on convenience: across 29 recorded runs each,
  // motherfuckingwebsite and brittanychiang legitimately alternate between static/0-states and
  // interactive/2-10-states depending on whether the browser rescue path engages (both flipped
  // repeatedly from 27 Jul onward, long before any recent change). A row that fails on a coin flip
  // trains everyone to ignore the grid, which is how a real regression gets waved through.
  { cat: "portfolio", url: "https://brittanychiang.com", expectMode: "any", expectLint: "url", thin: "maybe", lintOptional: true },
  { cat: "non-english", url: "https://about.gitlab.com/fr-fr/", expectMode: "any", expectLint: "any", thin: false }, // verification (c)
  { cat: "heavy-slow", url: "https://www.cnn.com", expectMode: "any", expectLint: "any", thin: "maybe" }, // bot-walled
  // THE TWO SHAPES THAT ACTUALLY BROKE US, absent from the original matrix — and they are the shapes
  // we are marketing to, so a regression here would land on a real founder first.
  //  · webgl-world: a GPU/CPU-heavy 3D scene. On 8 Aug this starved Playwright's actionability channel
  //    on the 2-core VM: every click hit the 2.5s wall, Sage never left the splash gate, and the plan
  //    collapsed to one "read the headline" mission. Nothing in the 11 rows above could have caught it.
  //    If Agora ever goes down, replace with ANY heavy 3D scene — the property under test is "the
  //    renderer is too busy to answer", not this product.
  //  · wallet-gated: the canonical web3 shape. The interesting half sits behind Connect Wallet, so the
  //    honest outcomes are a plan for the public half OR a needs_input naming the wall — never a
  //    fabricated mission about what is behind it.
  { cat: "webgl-world", url: "https://useagora.vercel.app/square", expectMode: "interactive", expectLint: "obs", thin: "maybe", accept: ["ready", "needs_input"] },
  { cat: "wallet-gated", url: "https://app.uniswap.org", expectMode: "any", expectLint: "any", thin: "maybe", accept: ["ready", "needs_input"] },
];

// MUST MIRROR normAnchorText in src/lib/launch/validate-mission.ts, typography folding included.
// When the gate learned to fold smart quotes/dashes (so a product rendering "Today\u2019s path" still
// matches an anchor written "Today's path") this ruler did not, and it reported anchor integrity 50%
// on yara.garden for an anchor the gate had CORRECTLY accepted. A measurement that disagrees with the
// thing it measures is worse than no measurement — it argues for reverting a good change.
const norm = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
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
    // NB: p.visibleTextExcerpt MUST stay in step with buildObservationCorpus (validate-mission.ts).
    // This mirror missing it is what failed round 3's anchors at 0–50%: the in-process gate rightly
    // accepted anchors quoted from page excerpts, and this stale copy then failed them post-hoc.
    for (const p of ft.pages || []) { push(p.title); push(p.h1); pushAll(p.ctas); push(p.visibleTextExcerpt); }
    // `delivered === false` states contribute no trigger — in step with buildObservationCorpus, which
    // excludes them so Sage's own failure sentences can never become a citable anchor.
    for (const s of ft.states || []) { if (s.delivered !== false) push(s.trigger); push(s.visibleTextExcerpt); for (const e of s.notableElements || []) push(e.text); }
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
    // POLL BUDGET, from measurement not habit. This was 30 x 10s = 5 minutes, which is SHORTER than
    // the work: a real inspection runs ~240s typically and up to ~660s on a site that challenges
    // automated visitors (measured on prod — notion.so 231s, linear.app 633s). So the battery gave up
    // on precisely the hard categories it exists to test and printed `FAIL(undefined)`, which reads
    // identically to a quality regression. On one run that was 3 of 11 categories, and all three had
    // finished `ready` with 8, 21 and 7 browser states.
    //
    // A battery that cries wolf is how a real regression gets waved through, so: wait past the
    // measured ceiling, and report a timeout AS a timeout — never as a failing check.
    // A POLL is not the measurement — it is the wire to it. One dropped connection anywhere in these
    // 72 attempts used to abort the row and print `ERROR: fetch failed`, which reads exactly like a
    // product regression: on the 8 Aug run that was 5 of 11 categories, every one of them healthy
    // (docs re-ran clean at anchors 100% minutes later). Tolerate transient failures, and give up only
    // when the wire is genuinely gone — then say THAT, never something about the product.
    let consecutiveWireFailures = 0;
    for (let t = 0; t < 150; t++) {
      try {
        const p = await (await fetch(`${base}/api/launch/${id}`)).json();
        job = p.job;
        consecutiveWireFailures = 0;
      } catch (e) {
        if (++consecutiveWireFailures >= 6) {
          return { ...m, error: `WIRE LOST after ${consecutiveWireFailures} consecutive poll failures (${String(e?.message || e).slice(0, 40)}) — job ${id} may still be fine` };
        }
      }
      if (["ready", "needs_input", "failed"].includes(job?.status)) break;
      await new Promise((r) => setTimeout(r, 10_000));
    }
    if (!["ready", "needs_input", "failed"].includes(job?.status)) {
      return { ...m, error: `TIMEOUT after 1500s (last stage: ${job?.status ?? "unknown"})` };
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
  // Explicit per-row ACCEPTANCE SET — the allowed terminal statuses for this URL. A marginal product (a
  // one-sentence page can honestly yield a thin mission OR a needs_input) lists BOTH, so a run-to-run
  // flip doesn't flake CI. `failed` is never acceptable. Default derives from `thin`; a row may override
  // with `accept`. `lintOptional` makes the url-vs-obs split informational (~) for variance-prone rows.
  const accept = m.accept ?? (m.thin === true ? ["needs_input"] : m.thin === "maybe" ? ["ready", "needs_input"] : ["ready"]);
  const softLint = (label) => (m.lintOptional ? `~(${label})` : `FAIL(${label})`);
  const checks = {
    mode: m.expectMode === "any" ? "n/a" : (ft ? (mode === m.expectMode ? "PASS" : `FAIL(${mode})`) : "n/a"),
    states: !isInteractive ? "n/a" : ((ft?.states?.length ?? 0) > 1 ? "PASS" : `FAIL(${ft?.states?.length ?? 0})`),
    loadingWaited: !isInteractive ? "n/a" : ((ft?.states || []).some((s) => /waited out loading/i.test(s.trigger)) ? "PASS" : "—"),
    category: job.status === "needs_input" ? "n/a" : (map?.category && map.category !== "product (uncategorized)" && !junkJourney ? "PASS" : `FAIL(${map?.category}${junkJourney ? "+junkJourney" : ""})`),
    anchorInteg: missions.length === 0 ? "n/a" : (integrity === 100 ? "PASS" : `FAIL(${integrity}%)`),
    lintSplit: missions.length === 0 ? "n/a" : (m.expectLint === "any" ? "PASS" : m.expectLint === "url" ? (urlV > 0 ? "PASS" : softLint(`0url/${obsV}obs`)) : (obsV > 0 ? "PASS" : softLint(`${urlV}url/0obs`))),
    needsInput: accept.includes(job.status) ? "PASS" : `FAIL(got-${job.status},want-${accept.join("|")})`,
    /**
     * PLAN-QUALITY LINT (2026-08-12) — the founder-facing failures each found live, one product at
     * a time, converted into checks that sweep every category at once:
     *   templateLeak — internal skeleton/attribution strings on a founder's screen ("Reach the
     *     target…" from an unresolved entity; "exactly what the founder asked" on a run whose goal
     *     was Sage's own synthesis — the battery sends no goal, so ANY founder-attribution is a lie).
     *   floor — no reward below the $3 tangible floor (three separate money-writers each violated
     *     it once; the lint watches the OUTPUT, whichever writer is last).
     *   coverage — a budget that tangibly funds 3+ missions collapsing onto ONE is thin coverage
     *     (measured twice on clawup $20). Informational (~): one deep mission can be a fair call.
     */
    templateLeak: missions.length === 0 ? "n/a"
      : missions.some((x) => /\bthe target\b/i.test(x.title || "") || /exactly what the founder asked/i.test(x.whyItMatters || ""))
        ? "FAIL(template)" : "PASS",
    floor: missions.length === 0 ? "n/a"
      : missions.every((x) => Number(x.rewardBase ?? 3_000_000) >= 3_000_000) ? "PASS"
      : `FAIL(${missions.filter((x) => Number(x.rewardBase ?? 0) < 3_000_000).map((x) => (Number(x.rewardBase) / 1e6).toFixed(2)).join(",")})`,
    coverage: missions.length === 0 || job.status !== "ready" ? "n/a"
      : (() => {
          const budget = Number(plan?.totalBudgetBase ?? 0) / 1e6;
          return budget >= 15 && missions.length === 1 ? `~(1-mission-on-$${Math.round(budget)})` : "PASS";
        })(),
  };
  return { ...m, status: job.status, mode, statesN: ft?.states?.length ?? 0, visionN, category: map?.category, name: map?.productName, missions: missions.length, urlV, obsV, integrity, estTokens, checks, questions: job.result?.questions || [], truncations: ft?.truncations ?? [] };
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
  // What the brain-view caps COST on this product. Not a failure — a fact that used to be invisible.
  // A product starved here (thousands of characters dropped) explains a thin plan far better than
  // "the model was weak", which is how the ClawUp pricing gap was misread for weeks.
  if (r.truncations.length) console.log(`      starved: ${r.truncations.map((t) => `${t.at} -${t.dropped} ${t.unit}`).join(" · ")}`);
}

// ── the grid ──
const CHECKS = ["mode", "states", "loadingWaited", "category", "anchorInteg", "lintSplit", "needsInput", "templateLeak", "floor", "coverage"];
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
