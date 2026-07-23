import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { runPromotionEval, type CallOutcome, type Checkpoint } from "./promotion-runner";
import { verifySubmission, providerForModel } from "./brain";
import { runEntailmentVeto, entailmentProvider } from "./entailment";
import { ENTAILMENT_FIXTURES } from "./entailment-fixtures";
import { judgeDecision, judgeMetricsFrom, JUDGE_PROMPT_VERSION, type JudgeRow, type JudgeOutcome } from "./judge-eval";
import { JUDGE_FIXTURES } from "./judge-fixtures";
import type { BrainInput } from "./brain-core";

/**
 * The manual PROMOTION runner (Gate C item 6) driving the REAL production path (verifySubmission / the
 * entailment veto) through the resumable, rate-limit-honest orchestrator. Skipped unless PROMOTION_EVAL=1.
 *
 *   PROMOTION_EVAL=1 PROMO_TARGET=judge PROMO_MODEL=anthropic/claude-haiku-4-5 PROMO_RUNS=3 \
 *   PROMO_CHECKPOINT=.promo-judge.json [PROMO_RESUME=1] [PROMO_MIN_INTERVAL=1500] \
 *   [PROMO_MAX_REQUESTS=200] [PROMO_MAX_COST=1.0] npx vitest run promotion-eval.live
 *
 * A promotion run is CONCLUSIVE only when it collected the required number of VALID model responses;
 * rate-limited / heuristic-fallback rows never fill the quota. It probes quota with one request and stops
 * on a 429 rather than grinding a throttled account.
 */
const LIVE = process.env.PROMOTION_EVAL === "1";
const TARGET = (process.env.PROMO_TARGET || "judge").toLowerCase();
const MODEL = process.env.PROMO_MODEL?.trim() || process.env.LLM_MODEL?.trim() || "anthropic/claude-haiku-4-5";
const RUNS = Math.max(1, Number(process.env.PROMO_RUNS) || 3);
const CHECKPOINT = process.env.PROMO_CHECKPOINT || `.promo-${TARGET}.json`;
const RESUME = process.env.PROMO_RESUME === "1";

/** wrap fetch to observe the LAST HTTP status + Retry-After, so runOne can tell 429 from a model failure. */
function statusCapturingFetch(): { fetchImpl: typeof fetch; last: () => { status: number | null; retryAfterMs: number | null } } {
  let status: number | null = null;
  let retryAfterMs: number | null = null;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetch(input, init);
    status = res.status;
    if (res.status === 429) {
      const ra = res.headers.get("retry-after");
      const secs = ra ? Number(ra) : NaN;
      retryAfterMs = Number.isFinite(secs) ? secs * 1000 : 30_000;
    }
    return res;
  }) as unknown as typeof fetch;
  return { fetchImpl, last: () => ({ status, retryAfterMs }) };
}

const loadCp = (): Checkpoint | null => (RESUME && existsSync(CHECKPOINT) ? (JSON.parse(readFileSync(CHECKPOINT, "utf8")) as Checkpoint) : null);
const saveCp = (c: Checkpoint) => writeFileSync(CHECKPOINT, JSON.stringify(c, null, 2));

describe.runIf(LIVE)("promotion runner — live production path", () => {
  it(`${TARGET} model=${MODEL} runs=${RUNS}: collects valid responses, rate-limit-honest`, async () => {
    const rows: JudgeRow[] = [];

    const runJudgeOne = async (fixtureId: string): Promise<CallOutcome> => {
      const f = JUDGE_FIXTURES.find((x) => x.id === fixtureId)!;
      const cap = statusCapturingFetch();
      const provider = providerForModel(MODEL);
      const input: BrainInput = {
        campaignTitle: "Sage paid product-testing mission", criteria: f.criteria, conditionType: "approval",
        note: f.note, wallet: `0x${"a".repeat(40)}`, evidenceUrl: "https://example.org/submission",
        evidenceText: f.evidenceText, evidenceOk: f.evidenceOk, contentSha256: null,
      };
      const brief = await verifySubmission(input, { provider, fallback: null, fetchImpl: cap.fetchImpl });
      const { status, retryAfterMs } = cap.last();
      if (brief.engine === "llm") {
        const { outcome, autopayQualified } = judgeDecision(brief);
        rows.push(rowFor(f.id, f.category, f.permitted, f.knownGap ?? null, brief.model, brief.provider, outcome, autopayQualified, brief.costUsd));
        return { kind: "valid", costUsd: brief.costUsd ?? 0, detail: outcome };
      }
      if (status === 429) return { kind: "rate_limited", retryAfterMs: retryAfterMs ?? undefined };
      if (status === 200) return { kind: "model_failure", detail: "heuristic despite 200 (unparseable/strict-reject)" };
      return { kind: "transient", detail: `status ${status ?? "none"}` };
    };

    const runEntailOne = async (fixtureId: string): Promise<CallOutcome> => {
      // DEDICATED entailment corpus (S5): one criterion + one VERBATIM quote per fixture — not the old
      // malformed multi-criterion adaptation of the judge fixtures that produced 0/15 model_failures.
      const f = ENTAILMENT_FIXTURES.find((x) => x.id === fixtureId)!;
      const cap = statusCapturingFetch();
      const provider = entailmentProvider();
      const input = { criteria: [{ id: "c0", criterion: f.criterion, quote: f.quote }], note: f.note };
      const res = await runEntailmentVeto(input, { provider: provider && { ...provider, model: MODEL }, fetchImpl: cap.fetchImpl });
      const { status, retryAfterMs } = cap.last();
      if (res.ran) {
        const verdict = res.verdicts[0]?.verdict ?? "uncertain";
        const correct = verdict === f.expected;
        return { kind: "valid", detail: `${f.trap}:${verdict}${correct ? "" : `(≠${f.expected})`}` };
      }
      if (status === 429) return { kind: "rate_limited", retryAfterMs: retryAfterMs ?? undefined };
      if (res.error === "invalid_output" || res.error === "abnormal_finish") return { kind: "model_failure", detail: res.error };
      return { kind: "transient", detail: res.error ?? `status ${status ?? "none"}` };
    };

    const result = await runPromotionEval({
      fixtures: (TARGET === "entail" ? ENTAILMENT_FIXTURES : JUDGE_FIXTURES).map((f) => ({ id: f.id })),
      runsPerFixture: RUNS,
      runOne: TARGET === "entail" ? runEntailOne : runJudgeOne,
      minIntervalMs: Number(process.env.PROMO_MIN_INTERVAL) || 1_200,
      budget: { maxRequests: Number(process.env.PROMO_MAX_REQUESTS) || undefined, maxCostUsd: Number(process.env.PROMO_MAX_COST) || undefined },
      checkpoint: { load: loadCp, save: saveCp },
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      log: (l) => console.log(l),
    });

    console.log("\nPROMOTION RESULT " + JSON.stringify(result, null, 2));
    if (result.status === "quota_blocked") {
      console.log(`⚠ QUOTA BLOCKED — earliest retry ${result.retryAfterMs ? Math.ceil(result.retryAfterMs / 1000) + "s" : "unknown"}. Inconclusive; not promotion evidence.`);
    }
    if (result.status === "conclusive" && TARGET === "judge") {
      const metrics = judgeMetricsFrom(rows, { model: MODEL, runs: RUNS, fixtures: JUDGE_FIXTURES.length });
      console.log("METRICS " + JSON.stringify(metrics, null, 2));
      expect(metrics.unexpectedWrongAutopays, `unexpected wrong-autopay: ${metrics.violations.join("; ")}`).toBe(0);
      expect(metrics.provenanceViolations).toBe(0);
    }
    // A quota-blocked or incomplete run is REPORTED, never a false green: it just isn't conclusive evidence.
    expect(["conclusive", "quota_blocked", "budget_exhausted", "incomplete"]).toContain(result.status);
  }, 3_600_000);
});

function rowFor(
  fixtureId: string, category: string, permitted: JudgeOutcome[], knownGap: string | null,
  model: string | null, provider: string | null, outcome: JudgeOutcome, autopayQualified: boolean, costUsd: number | null,
): JudgeRow {
  return {
    fixtureId, category, permitted, requestedModel: MODEL, actualModel: model, actualProvider: provider,
    engine: "llm", chain: "primary", promptVersion: JUDGE_PROMPT_VERSION, outcome, autopayQualified,
    decisionHash: "live", latencyMs: null, costUsd, status: "ok",
    valid: !!model, invalidReason: model ? null : "missing_provenance", knownGap,
    violation: outcome === "autopay" && !permitted.includes("autopay") ? (knownGap ? "known_gap:wrong_autopay" : "wrong_autopay") : null,
  };
}
