import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { llmCompleteJson, LlmCompletionError, resolveLlm } from "@/lib/llm/complete";
import { CRITIC_SYSTEM_V2, CRITIC_TRANSPORT_SCHEMA } from "./mission-grounding-shadow";
import { buildBatchedCriticInput, corpusDigest, CORPUS_VERSION, CRITIC_CORPUS } from "./grounding-critic-fixtures";
import { scoreCritic, type ScoreResult, type CriticVerdictOut } from "./grounding-critic-score";

/**
 * BLIND grounding-critic bake-off (grounding-critic-semantic-v1). Three cheap critic candidates × two
 * repeats = EXACTLY six maximum paid calls; each call batches the whole frozen corpus into ONE production
 * CRITIC_SYSTEM_V2 request (json_schema + the unchanged strict parser). NO architect calls. Append-only
 * ledger, persisted before every dispatch, never reset; no retries; stop on any 429/auth/strict/schema
 * failure. Scoring is model-blind (anonymous labels); identities are revealed only after scores finalize.
 */
const DRYRUN = process.env.GROUNDING_CRITIC_DRYRUN === "1";
const PAID = process.env.GROUNDING_CRITIC_BAKEOFF === "1";
const CAP = 6;
const SEED = 20260723; // recorded fixture-shuffle seed
const EVAL_ID = "grounding-critic-semantic-v1";
const EVIDENCE_DIR = path.resolve("promotion-evidence");
const LEDGER_PATH = path.join(EVIDENCE_DIR, `${EVAL_ID}.ledger.json`);
const EVIDENCE_PATH = path.join(EVIDENCE_DIR, `${EVAL_ID}.json`);
const CANDIDATE_C = process.env.GROUNDING_CRITIC_CANDIDATE_3?.trim() || "google/gemini-3.1-pro-preview";
const CANDIDATES = [{ key: "A", model: "anthropic/claude-haiku-4-5" }, { key: "B", model: "google/gemini-3.1-flash-lite-preview" }, { key: "C", model: CANDIDATE_C }];

function mulberry32(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle<T>(arr: T[], seed: number): T[] { const a = [...arr]; const r = mulberry32(seed); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const ORDER = shuffle(CRITIC_CORPUS.map((c) => c.id), SEED);
// deterministic blind labels: shuffle the candidates, then label a/b/c (identity hidden until reveal).
const LABELLED = shuffle(CANDIDATES, SEED ^ 0x5a5a).map((c, i) => ({ label: `candidate_${"abc"[i]}`, ...c }));

const normModel = (m: string | null | undefined) => (m ?? "").replace(/^(google|anthropic|openai|meta|mistral)\//, "").replace(/-\d{6,}$/, "");
const servedExplained = (req: string, served: string | null) => !served || normModel(req) === normModel(served);
const paySafeOkFor = (verdicts: CriticVerdictOut[], ids: string[]) => { const by = new Map(verdicts.map((v) => [v.missionKey, v.verdict])); return ids.every((id) => { const c = CRITIC_CORPUS.find((x) => x.id === id)!; const g = by.get(id); return g !== undefined && (g === "supported") === c.paySafeExpected; }); };

interface LedgerCall { seq: number; label: string; repeat: number; startedAt: string; completedAt: string | null; outcomeCode: string | null; terminalState: string; promptTokens: number | null; completionTokens: number | null; latencyMs: number | null }
interface Ledger { evaluationId: string; hardCap: number; callsConsumed: number; seed: number; corpusVersion: string; corpusDigest: string; calls: LedgerCall[]; done: string[] }
let ledger: Ledger = { evaluationId: EVAL_ID, hardCap: CAP, callsConsumed: 0, seed: SEED, corpusVersion: CORPUS_VERSION, corpusDigest: corpusDigest(), calls: [], done: [] };
const persist = () => { fs.mkdirSync(EVIDENCE_DIR, { recursive: true }); fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2)); };

async function registryModelIds(): Promise<Set<string>> {
  const p = resolveLlm(); if (!p) return new Set();
  const base = p.endpoint.replace(/\/chat\/completions$/, "");
  try { const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${p.key}` } }); if (!res.ok) return new Set(); const d = (await res.json()) as { data?: { id?: string }[] }; return new Set((d.data ?? []).map((m) => m.id ?? "").filter(Boolean)); } catch { return new Set(); }
}
const inRegistry = (reg: Set<string>, model: string) => reg.has(model) || [...reg].some((id) => normModel(id) === normModel(model));

async function oneCall(label: string, model: string, repeat: number): Promise<{ verdicts: CriticVerdictOut[]; served: string | null; tokens: number; latency: number } | { error: string; served: string | null; tokens: number; latency: number }> {
  if (ledger.callsConsumed >= CAP) throw new Error("llm_call_cap_reached");
  const rec: LedgerCall = { seq: ledger.callsConsumed + 1, label, repeat, startedAt: new Date().toISOString(), completedAt: null, outcomeCode: null, terminalState: "in_flight", promptTokens: null, completionTokens: null, latencyMs: null };
  ledger.calls.push(rec); ledger.callsConsumed += 1; persist();
  try {
    const r = await llmCompleteJson({ system: CRITIC_SYSTEM_V2, user: JSON.stringify(buildBatchedCriticInput(ORDER)), maxTokens: 4000, temperature: 0, model, parsePolicy: "strict", responseSchema: CRITIC_TRANSPORT_SCHEMA });
    rec.completedAt = new Date().toISOString(); rec.outcomeCode = "ok"; rec.terminalState = "completed"; rec.promptTokens = r.promptTokens; rec.completionTokens = r.completionTokens; rec.latencyMs = r.latencyMs; persist();
    const verdicts = Array.isArray((r.json as { verdicts?: unknown[] })?.verdicts) ? (r.json as { verdicts: CriticVerdictOut[] }).verdicts : [];
    return { verdicts, served: r.responseModel ?? r.model, tokens: (r.promptTokens ?? 0) + (r.completionTokens ?? 0), latency: r.latencyMs };
  } catch (e) {
    const err = e instanceof LlmCompletionError ? e : null;
    rec.completedAt = new Date().toISOString(); rec.outcomeCode = err?.code ?? (e instanceof Error ? e.message.slice(0, 40) : "error"); rec.terminalState = "failed"; rec.promptTokens = err?.promptTokens ?? null; rec.completionTokens = err?.completionTokens ?? null; rec.latencyMs = err?.latencyMs ?? null; persist();
    return { error: rec.outcomeCode!, served: err?.responseModel ?? null, tokens: (err?.promptTokens ?? 0) + (err?.completionTokens ?? 0), latency: err?.latencyMs ?? 0 };
  }
}

const verdictDigest = (v: CriticVerdictOut[]) => JSON.stringify([...v].sort((a, b) => (a.missionKey ?? "").localeCompare(b.missionKey ?? "")).map((x) => `${x.missionKey}:${x.verdict}`));

describe.runIf(DRYRUN || PAID)(`grounding-critic bake-off (${EVAL_ID})`, () => {
  beforeAll(() => { try { process.loadEnvFile(path.resolve(".env")); } catch { /* key may already be present */ } });

  it.runIf(DRYRUN)("DRY-RUN — plan + verify candidate C is in the registry (zero paid calls)", async () => {
    const reg = await registryModelIds();
    const cPresent = reg.size === 0 ? "registry_unavailable" : inRegistry(reg, CANDIDATE_C);
    console.log("[critic-bakeoff] DRY-RUN:\n" + JSON.stringify({ evaluationId: EVAL_ID, hardCap: CAP, seed: SEED, corpusVersion: CORPUS_VERSION, corpusDigest: corpusDigest(), candidateCModel: CANDIDATE_C, candidateC_inRegistry: cPresent, blindLabels: LABELLED.map((l) => l.label), fixtureOrder: ORDER, ledgerPath: LEDGER_PATH, evidencePath: EVIDENCE_PATH, confirm: "GROUNDING_CRITIC_BAKEOFF_CONFIRM=CALL_CAP_6" }, null, 2));
    if (reg.size > 0 && cPresent !== true) console.log(`[critic-bakeoff] STOP: candidate C '${CANDIDATE_C}' NOT in registry — supply GROUNDING_CRITIC_CANDIDATE_3 with an available model.`);
    expect(ledger.callsConsumed).toBe(0);
  });

  it.runIf(PAID)("LIVE — 3 candidates × 2 repeats, blind scoring, ≤6 calls", async () => {
    expect(process.env.GROUNDING_CRITIC_BAKEOFF_CONFIRM).toBe("CALL_CAP_6");
    if (fs.existsSync(LEDGER_PATH)) ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
    ledger.done = ledger.done ?? []; persist();

    // registry gate — never silently substitute candidate C.
    const reg = await registryModelIds();
    if (reg.size > 0 && !inRegistry(reg, CANDIDATE_C)) { fs.writeFileSync(EVIDENCE_PATH, JSON.stringify({ artifact: EVAL_ID, recommendation: "inconclusive", reason: `candidate C '${CANDIDATE_C}' not in registry; supply GROUNDING_CRITIC_CANDIDATE_3`, callsConsumed: ledger.callsConsumed }, null, 2)); console.log("[critic-bakeoff] STOP: candidate C not in registry"); expect(true).toBe(true); return; }

    const results: Record<string, { repeats: { verdicts: CriticVerdictOut[]; score: ScoreResult; digest: string; served: string | null; tokens: number; latency: number }[]; served: (string | null)[]; failed?: string }> = {};
    let stop: string | null = null;
    for (const cand of LABELLED) {
      results[cand.label] = { repeats: [], served: [] };
      for (let rep = 1; rep <= 2 && !stop; rep++) {
        if (ledger.callsConsumed >= CAP) { stop = "cap_reached"; break; }
        const out = await oneCall(cand.label, cand.model, rep);
        if ("error" in out) { results[cand.label].failed = out.error; results[cand.label].served.push(out.served); stop = out.error.includes("429") ? "quota_blocked" : "transport_failed"; break; }
        results[cand.label].served.push(out.served);
        results[cand.label].repeats.push({ verdicts: out.verdicts, score: scoreCritic(out.verdicts), digest: verdictDigest(out.verdicts), served: out.served, tokens: out.tokens, latency: out.latency });
      }
      if (stop) break;
    }

    // ── eligibility (blind, on scores only) ──
    const anon = LABELLED.map((cand) => {
      const rr = results[cand.label];
      const reps = rr.repeats;
      const servedOk = rr.served.every((s) => servedExplained(cand.model, s));
      const both = (f: (s: ScoreResult) => boolean) => reps.length === 2 && reps.every((x) => f(x.score));
      const displayTruthOk = reps.length === 2 && reps.every((x) => paySafeOkFor(x.verdicts, ["displayed_claim_supported", "underlying_claim_unproven"]));
      const eligible = servedOk && both((s) => s.schemaValid) && both((s) => s.completeCoverage) && both((s) => s.falseSupported === 0)
        && displayTruthOk && both((s) => s.goalAlignmentCorrect) && both((s) => s.injectionCaseCorrect) && both((s) => s.actionCausalityCorrect) && both((s) => s.supportedRecall >= 0.9);
      const totTokens = reps.reduce((a, x) => a + x.tokens, 0);
      const lats = reps.map((x) => x.latency).sort((a, b) => a - b);
      const medLat = lats.length ? lats[Math.floor(lats.length / 2)] : Infinity;
      const avgRecall = reps.length ? reps.reduce((a, x) => a + x.score.supportedRecall, 0) / reps.length : 0;
      const avgExact = reps.length ? reps.reduce((a, x) => a + x.score.exactVerdictCorrect, 0) / reps.length : 0;
      const consistent = reps.length === 2 && reps[0].digest === reps[1].digest;
      return { label: cand.label, eligible, failed: rr.failed ?? null, servedOk, displayTruthOk, avgRecall, avgExact, totTokens, medLat, consistent, falseSupportedCaseIds: [...new Set(reps.flatMap((x) => x.score.falseSupportedCaseIds))], falseRejectedCaseIds: [...new Set(reps.flatMap((x) => x.score.falseRejectedCaseIds))], perRepeatDigests: reps.map((x) => x.digest), scores: reps.map((x) => x.score) };
    });

    const eligibleAnon = anon.filter((a) => a.eligible).sort((a, b) => b.avgRecall - a.avgRecall || b.avgExact - a.avgExact || a.totTokens - b.totTokens || a.medLat - b.medLat);
    const winnerLabel = eligibleAnon[0]?.label ?? null;
    // every candidate got at least one scored/failed repeat → the bake-off effectively resolved each one.
    const allAttempted = LABELLED.every((c) => results[c.label].repeats.length + (results[c.label].failed ? 1 : 0) >= 1);
    let recommendation: string;
    if (winnerLabel) recommendation = "critic_candidate_selected";
    else if (stop === "quota_blocked") recommendation = "quota_blocked";
    else if (allAttempted && anon.every((a) => !a.eligible)) recommendation = "no_critic_eligible"; // substantive: none met the bar (do NOT pick the least-bad)
    else if (stop === "transport_failed") recommendation = "transport_failed";
    else recommendation = "inconclusive";

    // reveal identities ONLY now (after scoring/selection).
    const reveal = Object.fromEntries(LABELLED.map((c) => [c.label, { requested: c.model, served: results[c.label].served }]));
    const evidence = { artifact: EVAL_ID, note: "grounding critic semantic calibration — NOT model approval, NOT promotion-ready", timestamp: new Date().toISOString(), corpusVersion: CORPUS_VERSION, corpusDigest: corpusDigest(), shuffleSeed: SEED, fixtureOrder: ORDER, callsConsumed: ledger.callsConsumed, hardCap: CAP, stop, anonymousResults: anon, revealedModels: reveal, winnerLabel, winnerModel: winnerLabel ? reveal[winnerLabel].requested : null, recommendation, configurationConclusive: !stop, semanticEvaluationConclusive: recommendation === "critic_candidate_selected" || recommendation === "no_critic_eligible" };
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
    console.log(`[critic-bakeoff] recommendation=${recommendation} winner=${winnerLabel ?? "none"} calls=${ledger.callsConsumed} stop=${stop ?? "none"}`);

    expect(ledger.callsConsumed).toBeLessThanOrEqual(CAP);
  }, 300_000);
});
