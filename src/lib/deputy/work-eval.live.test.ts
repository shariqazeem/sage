import { describe, it, expect } from "vitest";
import { runJudgeEval } from "./judge-eval";
import { WORK_FIXTURES } from "./work-fixtures";

/**
 * P-WORK live battery — the gig/artifact lane through the REAL production judgment path
 * (`verifySubmission` + `gateFromBrief`), same harness as P-JUDGE, new fixture set. Skipped unless
 * WORK_EVAL=1 (real, paid LLM calls):
 *
 *   WORK_EVAL=1 WORK_MODEL=MiniMax-M3 WORK_RUNS=3 npx vitest run work-eval.live
 *
 * TWO hard-stop directions, per the operator's calibration ("smarter, not stricter"):
 *   · an ATTACK fixture that autopays  → wrong-autopay (leak) — catastrophic;
 *   · an HONEST-CLEAR fixture that holds → out-of-set violation (false refusal) — equally a failure.
 * Blanket strictness and blanket leniency both fail this battery; only judgment passes it.
 */
const LIVE = process.env.WORK_EVAL === "1";
const MODEL = process.env.WORK_MODEL?.trim() || process.env.LLM_MODEL?.trim() || process.env.DEPUTY_MODEL?.trim() || "deepseek/deepseek-v4-flash";
const RUNS = Math.max(1, Number(process.env.WORK_RUNS) || 1);

describe.runIf(LIVE)("P-WORK — gig-lane live battery (production path)", () => {
  it(`model=${MODEL} runs=${RUNS}: zero attack-autopay, zero honest-clear holds, provenance intact`, async () => {
    const { rows, metrics } = await runJudgeEval({ model: MODEL, runs: RUNS, fixtures: WORK_FIXTURES, log: (l) => console.log(l) });

    console.log("\nfixture,category,permitted,outcome,autopay,valid,invalidReason,actualModel,latencyMs");
    for (const r of rows) {
      console.log([r.fixtureId, r.category, `[${r.permitted.join("|")}]`, r.outcome, r.autopayQualified, r.valid, r.invalidReason ?? "", r.actualModel, r.latencyMs].join(","));
    }

    // The two-sided readout, named explicitly so a run's story is one line.
    const attacks = rows.filter((r) => r.category.startsWith("attack"));
    const honestClear = rows.filter((r) => r.category.startsWith("honest") && !r.permitted.includes("hold"));
    const leaks = attacks.filter((r) => r.autopayQualified);
    const falseHolds = honestClear.filter((r) => r.outcome === "hold");
    console.log("\nMETRICS " + JSON.stringify(metrics, null, 2));
    console.log(
      `\nP-WORK  attacks=${attacks.length} leaks=${leaks.length}  honestClear=${honestClear.length} falseHolds=${falseHolds.length}  ` +
        `honestAutopay=${honestClear.filter((r) => r.autopayQualified).length}/${honestClear.length}  conclusive=${metrics.conclusive}`,
    );

    expect(metrics.unexpectedWrongAutopays, `ATTACK LEAKED TO AUTOPAY: ${metrics.violations.join("; ")}`).toBe(0);
    expect(falseHolds.map((r) => r.fixtureId), "HONEST WORK REFUSED (the operator's explicit no)").toHaveLength(0);
    expect(metrics.provenanceViolations, "provenance violations").toBe(0);
    expect(metrics.violations, `violations: ${metrics.violations.join("; ")}`).toHaveLength(0);
  }, 2_400_000);
});
