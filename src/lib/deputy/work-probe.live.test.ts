import { describe, it } from "vitest";
import { providerForModel, verifySubmission } from "./brain";
import { WORK_FIXTURES } from "./work-fixtures";

/**
 * P-WORK DIAGNOSTIC PROBE — dumps the judge's FULL brief (reasonCode, summary, fraud signals,
 * per-criterion verdicts) for one honest and one attack fixture, so a falseHold epidemic can be
 * diagnosed at the reasoning level instead of guessed at. Gated (real LLM calls):
 *
 *   WORK_PROBE=1 npx vitest run work-probe.live
 */
const LIVE = process.env.WORK_PROBE === "1";
const MODEL = process.env.WORK_MODEL?.trim() || "MiniMax-M3";

describe.runIf(LIVE)("P-WORK probe — full briefs", () => {
  it(`dumps briefs (${MODEL})`, async () => {
    for (const id of (process.env.WORK_PROBE_IDS ?? "wp-honest-menu-full,wp-bluff-claim").split(",")) {
      const f = WORK_FIXTURES.find((x) => x.id === id.trim())!;
      // EXACTLY the harness's input construction (judge-eval.ts) — the probe exists to explain
      // battery outcomes, so any divergence here makes its explanations about a different question.
      const brief = await verifySubmission(
        {
          campaignTitle: f.campaignTitle ?? "Sage paid product-testing mission",
          criteria: f.criteria,
          conditionType: "approval",
          note: f.note,
          wallet: f.wallet ?? `0x${"a".repeat(40)}`,
          evidenceUrl: f.evidenceUrl ?? "https://example.org/submission",
          evidenceText: f.evidenceText,
          evidenceOk: f.evidenceOk,
          evidenceFailReason: undefined,
          contentSha256: null,
          verifierReport: f.verifierReport ?? null,
        } as never,
        { provider: providerForModel(MODEL) },
      );
      console.log(`\n===== ${id} =====`);
      console.log(JSON.stringify({
        recommendation: brief.recommendation,
        reasonCode: brief.reasonCode,
        confidence: brief.confidence,
        summary: brief.summary,
        fraudSignals: brief.fraudSignals,
        criteria: brief.criteria,
        engine: brief.engine,
        model: brief.model,
      }, null, 1));
    }
  }, 600_000);
});
