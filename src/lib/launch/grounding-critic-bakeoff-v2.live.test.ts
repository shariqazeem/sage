import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { llmCompleteJson, LlmCompletionError } from "@/lib/llm/complete";
import { CRITIC_SYSTEM_V3, CRITIC_TRANSPORT_SCHEMA_V3, CRITIC_CONTRACT_VERSION } from "./mission-grounding-shadow";
import { buildBatchedV3Input, corpusV2Digest, CORPUS_V2_VERSION, CRITIC_CORPUS_V2 } from "./grounding-critic-fixtures-v2";
import { scoreCriticV2, type ScoreV2, type V3VerdictOut } from "./grounding-critic-score-v2";

/**
 * Phase 4 — BLIND two-model calibration of the V3 (decision-bound) critic on corpus-v2. Candidates: A
 * gemini-3.1-flash-lite, B claude-haiku-4-5. Max 2 repeats each = ≤4 paid calls (part of the sprint's
 * cumulative 6). Same corpus-v2 / V3 prompt / json_schema / strict parser / shuffle seed / token limit /
 * temperature / scoring for both. Blind: seeded anonymous labels; the scorer sees only labels + verdicts;
 * identities revealed only after scoring. Append-only ledger, persisted before each call; no retries; stop
 * the whole eval on 429 / auth / unexplained served-model substitution. Guard
 * GROUNDING_CRITIC_BAKEOFF2_CONFIRM=CALL_CAP_4.
 */
const DRYRUN = process.env.GROUNDING_CRITIC2_DRYRUN === "1";
const PAID = process.env.GROUNDING_CRITIC2 === "1";
const CAP = 4;
const SEED = 20260724;
const EVAL_ID = "grounding-critic-semantic-v2";
const EVIDENCE_DIR = path.resolve("promotion-evidence");
const LEDGER_PATH = path.join(EVIDENCE_DIR, `${EVAL_ID}.ledger.json`);
const EVIDENCE_PATH = path.join(EVIDENCE_DIR, `${EVAL_ID}.json`);
const CANDIDATES = [{ key: "A", model: "google/gemini-3.1-flash-lite-preview" }, { key: "B", model: "anthropic/claude-haiku-4-5" }];

function mulberry32(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle<T>(arr: T[], seed: number): T[] { const a = [...arr]; const r = mulberry32(seed); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const ORDER = shuffle(CRITIC_CORPUS_V2.map((c) => c.id), SEED);
const LABELLED = shuffle(CANDIDATES, SEED ^ 0x33cc).map((c, i) => ({ label: `candidate_${"ab"[i]}`, ...c }));
const normModel = (m: string | null | undefined) => (m ?? "").replace(/^(google|anthropic|openai|meta|mistral)\//, "").replace(/-\d{6,}$/, "");
const servedExplained = (req: string, served: string | null) => !served || normModel(req) === normModel(served);
const semanticOk = (s: ScoreV2) => s.strictSchemaValid && s.exactDecisionCoverage && s.falseSupported === 0 && s.supportedRecall >= 0.9 && s.displayVsTruthCorrect && s.goalAlignmentCorrect && s.actionCausalityCorrect && s.injectionCaseCorrect;

interface LedgerCall { seq: number; label: string; repeat: number; startedAt: string; completedAt: string | null; outcomeCode: string | null; terminalState: string; promptTokens: number | null; completionTokens: number | null; latencyMs: number | null }
interface Ledger { evaluationId: string; hardCap: number; callsConsumed: number; seed: number; corpusVersion: string; corpusDigest: string; contract: string; calls: LedgerCall[] }
let ledger: Ledger = { evaluationId: EVAL_ID, hardCap: CAP, callsConsumed: 0, seed: SEED, corpusVersion: CORPUS_V2_VERSION, corpusDigest: corpusV2Digest(), contract: CRITIC_CONTRACT_VERSION, calls: [] };
const persist = () => { fs.mkdirSync(EVIDENCE_DIR, { recursive: true }); fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2)); };

async function oneCall(label: string, model: string, repeat: number): Promise<{ score: ScoreV2; served: string | null; tokens: number; latency: number } | { error: string; served: string | null }> {
  if (ledger.callsConsumed >= CAP) throw new Error("llm_call_cap_reached");
  const { input, decisionToCaseId } = buildBatchedV3Input(ORDER);
  const rec: LedgerCall = { seq: ledger.callsConsumed + 1, label, repeat, startedAt: new Date().toISOString(), completedAt: null, outcomeCode: null, terminalState: "in_flight", promptTokens: null, completionTokens: null, latencyMs: null };
  ledger.calls.push(rec); ledger.callsConsumed += 1; persist();
  try {
    const r = await llmCompleteJson({ system: CRITIC_SYSTEM_V3, user: JSON.stringify(input), maxTokens: 1600, temperature: 0, model, parsePolicy: "strict", responseSchema: CRITIC_TRANSPORT_SCHEMA_V3 });
    rec.completedAt = new Date().toISOString(); rec.outcomeCode = "ok"; rec.terminalState = "completed"; rec.promptTokens = r.promptTokens; rec.completionTokens = r.completionTokens; rec.latencyMs = r.latencyMs; persist();
    const verdicts = Array.isArray((r.json as { verdicts?: unknown[] })?.verdicts) ? (r.json as { verdicts: V3VerdictOut[] }).verdicts : [];
    return { score: scoreCriticV2(verdicts, decisionToCaseId), served: r.responseModel ?? r.model, tokens: (r.promptTokens ?? 0) + (r.completionTokens ?? 0), latency: r.latencyMs };
  } catch (e) {
    const err = e instanceof LlmCompletionError ? e : null;
    rec.completedAt = new Date().toISOString(); rec.outcomeCode = err?.code ?? (e instanceof Error ? e.message.slice(0, 40) : "error"); rec.terminalState = "failed"; rec.promptTokens = err?.promptTokens ?? null; rec.completionTokens = err?.completionTokens ?? null; rec.latencyMs = err?.latencyMs ?? null; persist();
    return { error: rec.outcomeCode!, served: err?.responseModel ?? null };
  }
}

describe.runIf(DRYRUN || PAID)(`grounding-critic V3 calibration (${EVAL_ID})`, () => {
  beforeAll(() => { if (PAID) { try { process.loadEnvFile(path.resolve(".env")); } catch { /* key may already be present */ } } });

  it.runIf(DRYRUN)("DRY-RUN — plan, zero paid calls", () => {
    console.log("[critic-v2-bakeoff] DRY-RUN:\n" + JSON.stringify({ evaluationId: EVAL_ID, hardCap: CAP, seed: SEED, contract: CRITIC_CONTRACT_VERSION, corpusVersion: CORPUS_V2_VERSION, corpusDigest: corpusV2Digest(), blindLabels: LABELLED.map((l) => l.label), fixtureOrder: ORDER, ledgerPath: LEDGER_PATH, evidencePath: EVIDENCE_PATH, confirm: "GROUNDING_CRITIC_BAKEOFF2_CONFIRM=CALL_CAP_4" }, null, 2));
    expect(ledger.callsConsumed).toBe(0);
  });

  it.runIf(PAID)("LIVE — 2 candidates × ≤2 repeats, blind, decision-bound scoring, ≤4 calls", async () => {
    expect(process.env.GROUNDING_CRITIC_BAKEOFF2_CONFIRM).toBe("CALL_CAP_4");
    if (fs.existsSync(LEDGER_PATH)) ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
    persist();

    const results: Record<string, { repeats: { score: ScoreV2; served: string | null; tokens: number; latency: number }[]; served: (string | null)[]; failure?: string; ineligibleReason?: string }> = {};
    let stop: string | null = null, modelSubstitution: string | null = null;
    for (const cand of LABELLED) {
      results[cand.label] = { repeats: [], served: [] };
      const rr = results[cand.label];
      for (let rep = 1; rep <= 2 && !stop; rep++) {
        if (ledger.callsConsumed >= CAP) { rr.ineligibleReason = rr.ineligibleReason ?? "cap_reached"; break; }
        const out = await oneCall(cand.label, cand.model, rep);
        rr.served.push(out.served);
        if ("error" in out) { rr.failure = out.error; rr.ineligibleReason = out.error; if (out.error.includes("429") || out.error.includes("401") || out.error.includes("403")) stop = "quota_or_auth"; break; } // schema/transport → ineligible, continue to next candidate
        if (out.served && !servedExplained(cand.model, out.served)) { modelSubstitution = `${cand.label} ${cand.model}→${out.served}`; stop = "model_substitution"; break; }
        rr.repeats.push(out);
        // CALL-SAVING: a semantic hard failure (or falseSupported>0) on repeat 1 → skip repeat 2.
        if (rep === 1 && (out.score.falseSupported > 0 || !semanticOk(out.score))) { rr.ineligibleReason = out.score.falseSupported > 0 ? "false_supported" : "semantic_hard_fail_rep1"; break; }
      }
      if (stop) break;
    }

    const anon = LABELLED.map((cand) => {
      const rr = results[cand.label];
      const reps = rr.repeats;
      const servedOk = rr.served.filter(Boolean).every((s) => servedExplained(cand.model, s));
      const eligible = !rr.failure && !rr.ineligibleReason && reps.length === 2 && reps.every((x) => semanticOk(x.score)) && servedOk;
      const avgRecall = reps.length ? reps.reduce((a, x) => a + x.score.supportedRecall, 0) / reps.length : 0;
      const avgExact = reps.length ? reps.reduce((a, x) => a + x.score.exactVerdictAccuracy, 0) / reps.length : 0;
      const totTokens = reps.reduce((a, x) => a + x.tokens, 0);
      const lats = reps.map((x) => x.latency).sort((a, b) => a - b);
      const medLat = lats.length ? lats[Math.floor(lats.length / 2)] : Infinity;
      const consistent = reps.length === 2 && JSON.stringify(reps[0].score) === JSON.stringify(reps[1].score);
      return { label: cand.label, eligible, ineligibleReason: rr.ineligibleReason ?? null, servedOk, avgRecall, avgExact, totTokens, medLat, consistent, falseSupportedCaseIds: [...new Set(reps.flatMap((x) => x.score.falseSupportedCaseIds))], falseRejectedCaseIds: [...new Set(reps.flatMap((x) => x.score.falseRejectedCaseIds))], scores: reps.map((x) => x.score) };
    });

    const eligibleAnon = anon.filter((a) => a.eligible).sort((a, b) => b.avgRecall - a.avgRecall || b.avgExact - a.avgExact || a.totTokens - b.totTokens || a.medLat - b.medLat);
    const winnerLabel = eligibleAnon[0]?.label ?? null;
    let recommendation: string;
    if (stop === "model_substitution") recommendation = "inconclusive";
    else if (stop === "quota_or_auth") recommendation = "quota_or_auth_blocked";
    else if (winnerLabel) recommendation = "critic_candidate_selected";
    else recommendation = "no_critic_eligible";

    const reveal = Object.fromEntries(LABELLED.map((c) => [c.label, { requested: c.model, served: results[c.label].served }]));
    const evidence = { artifact: EVAL_ID, note: "V3 critic calibration on corpus-v2 — NOT model approval, NOT promotion-ready", timestamp: new Date().toISOString(), contract: CRITIC_CONTRACT_VERSION, corpusVersion: CORPUS_V2_VERSION, corpusDigest: corpusV2Digest(), shuffleSeed: SEED, fixtureOrder: ORDER, callsConsumed: ledger.callsConsumed, hardCap: CAP, stop, modelSubstitution, anonymousResults: anon, revealedModels: reveal, winnerLabel, grounding_critic_canary_candidate: winnerLabel ? reveal[winnerLabel].requested : null, recommendation, configurationConclusive: !stop, eligibilityConclusionConclusive: recommendation === "critic_candidate_selected" || recommendation === "no_critic_eligible" };
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
    console.log(`[critic-v2-bakeoff] recommendation=${recommendation} winner=${winnerLabel ?? "none"} calls=${ledger.callsConsumed} stop=${stop ?? "none"}`);

    expect(ledger.callsConsumed).toBeLessThanOrEqual(CAP);
  }, 240_000);
});
