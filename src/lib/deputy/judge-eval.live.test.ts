import { describe, it, expect } from "vitest";
import { runJudgeEval } from "./judge-eval";
import { JUDGE_FIXTURES } from "./judge-fixtures";

/**
 * P-JUDGE live semantic battery — invokes the REAL `verifySubmission` + `gateFromBrief` against a chosen
 * model and asserts the promotion hard-stops: zero wrong-autopay, no result outside its permitted set,
 * intact model provenance. Skipped unless JUDGE_EVAL=1 (it makes real, paid LLM calls). Run a promotion
 * candidate ≥3×:
 *
 *   JUDGE_EVAL=1 JUDGE_MODEL=anthropic/claude-haiku-4-5 JUDGE_RUNS=3 npx vitest run judge-eval.live
 */
const LIVE = process.env.JUDGE_EVAL === "1";
const MODEL = process.env.JUDGE_MODEL?.trim() || process.env.LLM_MODEL?.trim() || process.env.DEPUTY_MODEL?.trim() || "deepseek/deepseek-v4-flash";
const RUNS = Math.max(1, Number(process.env.JUDGE_RUNS) || 1);

describe.runIf(LIVE)("P-JUDGE — live semantic battery (production path)", () => {
  it(`model=${MODEL} runs=${RUNS}: zero wrong-autopay, all in-set, provenance intact`, async () => {
    const { rows, metrics } = await runJudgeEval({ model: MODEL, runs: RUNS, fixtures: JUDGE_FIXTURES, log: (l) => console.log(l) });

    console.log("\nfixture,category,permitted,outcome,autopayQualified,actualModel,provider,chain,promptVer,latencyMs,decisionHash,status");
    for (const r of rows) {
      console.log([r.fixtureId, r.category, `[${r.permitted.join("|")}]`, r.outcome, r.autopayQualified, r.actualModel, r.actualProvider, r.chain, r.promptVersion, r.latencyMs, r.decisionHash, r.status].join(","));
    }
    console.log("\nMETRICS " + JSON.stringify(metrics, null, 2));

    // HARD STOPS — any of these ⇒ do NOT promote this model.
    expect(metrics.wrongAutopay, `wrong-autopay: ${metrics.violations.join("; ")}`).toBe(0);
    expect(metrics.provenanceViolations, "provenance violations").toBe(0);
    expect(metrics.violations, `violations: ${metrics.violations.join("; ")}`).toHaveLength(0);
    expect(rows.every((r) => r.status === "ok"), "a production call threw").toBe(true);
  }, 600_000);
});
