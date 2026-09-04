import { describe, expect, it } from "vitest";
import { runDirectEval } from "./direct-eval";
import { DIRECT_FIXTURES } from "./direct-fixtures";

/**
 * P-DIRECT live battery — real founder wording → the REAL concierge prompt + tool schema → the
 * REAL compiler. Skipped unless DIRECT_EVAL=1 (it makes paid LLM calls):
 *
 *   DIRECT_EVAL=1 DIRECT_RUNS=2 npx vitest run direct-eval.live
 *
 * HARD STOPS — each one is money that would have moved wrongly:
 *   · routed into the wrong lane (a testing ask funded as a gig, or the reverse);
 *   · the budget invariant broken (Σ reward×slots ≠ total);
 *   · the founder's stated amount drifting;
 *   · milestones the founder never asked for;
 *   · a mission with no verification contract (unpayable-but-fundable work).
 */
const LIVE = process.env.DIRECT_EVAL === "1";
const RUNS = Math.max(1, Number(process.env.DIRECT_RUNS) || 1);
const ONLY = process.env.DIRECT_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);

describe.runIf(LIVE)("P-DIRECT — money-lane battery (production path)", () => {
  it(`runs=${RUNS}: correct lane, exact budget, faithful amounts, verifiable contracts`, async () => {
    const fixtures = ONLY?.length ? DIRECT_FIXTURES.filter((f) => ONLY.includes(f.id)) : DIRECT_FIXTURES;
    if (ONLY?.length) console.log(`⚠ DIRECT_ONLY active — NOT a full battery`);
    const { rows, metrics } = await runDirectEval({ fixtures, runs: RUNS, log: (l) => console.log(l) });

    // no-tool rows carry the model's own words, so a routing miss can be diagnosed from the log
    for (const r of rows.filter((x) => !x.calledTool && x.reply)) {
      console.log(`\n[no-tool] ${r.fixtureId}: ${r.reply}`);
    }
    for (const r of rows.filter((x) => x.rawArgs)) {
      console.log(`\n[raw] ${r.fixtureId}: ${r.rawArgs}`);
    }
    console.log("\nfixture,category,tool,routedOk,compiled,budgetExact,totalUsd,milestones,firstShotMs,termsFired,lint,error");
    for (const r of rows) {
      console.log(
        [r.fixtureId, r.category, r.calledTool ? (r.deterministic ? "direct(det)" : "direct") : "-", r.routedOk, r.compiled, r.budgetExact ?? "", r.totalUsd ?? "", r.milestones ?? "", r.firstShotMilestones ?? "", r.statedTermsFired, r.lintNotes.length, r.error ?? ""].join(","),
      );
    }
    const firstShot = rows.filter((r) => r.compiled && r.correctionRounds === 0).length;
    const afterFix = rows.filter((r) => r.compiled && r.correctionRounds > 0).length;
    console.log(`\nfirst-shot compiles: ${firstShot} · compiled after one correction: ${afterFix}`);
    // The guard's own effect, stated plainly: how often the model's first shot contradicted the
    // founder's arithmetic. amountDrift below is the outcome AFTER that correction — the pair is
    // what tells a model regression apart from a guard doing its job.
    console.log(`stated-terms caught on first shot: ${metrics.statedTermsCaught}/${rows.length}`);
    console.log("\nMETRICS " + JSON.stringify(metrics, null, 1));
    if (metrics.violations.length) console.log("\nVIOLATIONS:\n - " + metrics.violations.join("\n - "));

    // A RUN WITH NO ROWS IS NOT A PASS. Every metric below is a count of bad rows, so a battery
    // where the provider failed on everything scores zero of everything and "passes" vacuously —
    // the broken-ruler failure. Assert the evidence exists before judging it.
    expect(metrics.providerFailures, "provider failures — this run is NOT evidence").toBe(0);
    expect(rows.length, "no rows produced — nothing was measured").toBe(fixtures.length * RUNS);

    expect(metrics.budgetViolations, "BUDGET INVARIANT").toBe(0);
    expect(metrics.amountDrift, "the founder's own amount must survive").toBe(0);
    expect(metrics.inventedMilestones, "milestones the founder never asked for").toBe(0);
    expect(metrics.unverifiableMissions, "fundable work with nothing to verify").toBe(0);
    expect(metrics.compileFailures, "model produced args the compiler refused").toBe(0);
    expect(metrics.routedWrong, `wrong lane: ${metrics.violations.join("; ")}`).toBe(0);
  }, 2_400_000);
});
