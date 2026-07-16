import { describe, it, expect } from "vitest";
import { validateEvidenceUrl } from "@/lib/campaigns/validate";
import { fetchEvidence } from "@/lib/deputy/evidence";
import { verifySubmission } from "@/lib/deputy/brain";

/**
 * STEP 9 (of the required Phase-2 ordering): run Sage's REAL evidence-fetch/SSRF
 * path against the live public HTTPS fixture, then a REAL brain dry-run against the
 * exact FROZEN trusted judge context. NO chain, NO db writes. This is the go/no-go
 * gate before any blockchain transaction: if the model does not genuinely approve,
 * the exercise stops here and the model's real reasoning is recorded — never forced.
 */

const URL = "https://sage.80.225.209.190.sslip.io/ai-proof-fixture.txt";
const EXP_SHA = "35d2b4c27dafedc6f8fd7932de6ab3cc010a8d2d4bbde15fee01fdce5a516ab6";

// The EXACT trusted context the real pipeline builds for this mission (from the
// immutable locked mission snapshot) — title/objective, Task, Target surface,
// ordered criteria, Required-evidence. Reward is NEVER included.
const judgeTitle =
  "Verify Sage's public AI proof fixture — Confirm that the supplied public HTTPS evidence page contains the exact CampaignVaultV2 verification phrase.";
const judgeCriteria = [
  "Task: Open the supplied HTTPS URL. Locate the verification phrase. Submit the source URL, the exact quoted phrase, and one concise sentence describing where it appears.",
  "Target surface: https://sage.80.225.209.190.sslip.io/ai-proof-fixture.txt",
  "The evidence URL is publicly reachable over HTTPS.",
  "The fetched evidence contains the exact phrase SAGE_V2_AI_PIPELINE_OK.",
  "The submitted quote exactly matches the phrase in the fetched evidence.",
  "Required evidence: The public HTTPS source URL.",
  "Required evidence: The exact verification phrase quoted from the fetched evidence.",
  "Required evidence: A concise observation describing where the phrase appears.",
];
// The tester's honest submission note (untrusted input).
const NOTE =
  'I opened the target URL over HTTPS. The page contains the verification phrase "SAGE_V2_AI_PIPELINE_OK" on its third line (the line reading "Verification phrase: SAGE_V2_AI_PIPELINE_OK"). Source: https://sage.80.225.209.190.sslip.io/ai-proof-fixture.txt';
const WALLET = "0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3";

describe("STEP 9 — real SSRF/evidence path + brain dry-run (no chain, no db writes)", () => {
  it("SSRF guard ACCEPTS the public HTTPS fixture (guard used unchanged)", () => {
    const v = validateEvidenceUrl(URL);
    console.log("STEP9_SSRF", JSON.stringify(v));
    expect(v.ok).toBe(true);
  });

  it("real fetchEvidence returns the fixture with the exact phrase + sha", async () => {
    const ev = await fetchEvidence(URL);
    console.log(
      "STEP9_EVIDENCE",
      JSON.stringify({ ok: ev.ok, sha: ev.contentSha256, failReason: ev.failReason, textLen: ev.text.length }),
    );
    expect(ev.ok).toBe(true);
    expect(ev.text).toContain("SAGE_V2_AI_PIPELINE_OK");
    expect(ev.contentSha256).toBe(EXP_SHA);
  });

  it("real brain dry-run against the frozen trusted context — records the model's verdict", async () => {
    const ev = await fetchEvidence(URL);
    const brief = await verifySubmission({
      campaignTitle: judgeTitle,
      criteria: judgeCriteria,
      conditionType: "approval",
      note: NOTE,
      wallet: WALLET,
      evidenceUrl: URL,
      evidenceText: ev.text,
      evidenceOk: ev.ok,
      evidenceFailReason: ev.failReason,
      contentSha256: ev.contentSha256,
    });
    console.log(
      "STEP9_BRIEF",
      JSON.stringify(
        {
          engine: brief.engine,
          model: brief.model,
          provider: brief.provider,
          recommendation: brief.recommendation,
          confidence: brief.confidence,
          reasonCode: brief.reasonCode,
          evidenceOk: brief.evidenceOk,
          latencyMs: brief.latencyMs,
          costUsd: brief.costUsd,
          highFraud: brief.fraudSignals.some((f) => f.severity === "high"),
          summary: brief.summary,
          criteria: brief.criteria.map((c) => ({
            criterion: c.criterion.slice(0, 48),
            met: c.met,
            confidence: c.confidence,
            quote: c.quote?.slice(0, 48) ?? null,
          })),
        },
        null,
        2,
      ),
    );
    // The LLM must actually run (never the keyless heuristic — that can't auto-pay).
    expect(brief.engine).toBe("llm");
    // Report the go/no-go verdict explicitly; do NOT force a pay.
    const qualifies =
      brief.engine === "llm" &&
      brief.recommendation === "pay" &&
      brief.confidence >= 0.85 &&
      !brief.fraudSignals.some((f) => f.severity === "high") &&
      brief.evidenceOk;
    console.log("STEP9_GO_NOGO", qualifies ? "GO (model genuinely approves)" : "NO-GO (model did not approve — stop, do not deploy)");
  });
});
