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
    for (const id of ["wp-honest-menu-full", "wp-bluff-claim"]) {
      const f = WORK_FIXTURES.find((x) => x.id === id)!;
      const brief = await verifySubmission(
        {
          campaignTitle: "Gig campaign",
          criteria: f.criteria,
          conditionType: null,
          note: f.note,
          wallet: "0xccbfb9bba88f282282a29aa1338175cc835e768d",
          evidenceUrl: "https://paste.rs/h1",
          evidenceText: f.evidenceText,
          evidenceOk: f.evidenceOk,
          evidenceFailReason: undefined,
          contentSha256: "c".repeat(64),
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
