/**
 * The autopay-approved JUDGE MODEL policy — deterministic pipeline code, never a prompt.
 *
 * An autopay is authorized ONLY when the model that ACTUALLY produced the brief (`brief.model`, stamped
 * by callProvider — not the requested env var) is on this explicit, versioned allowlist. So:
 *   · an approved actual model + a qualifying brief → continues through the existing gates;
 *   · a FALLBACK model that isn't independently approved → manual review;
 *   · missing/unknown provenance (null model) → manual review;
 *   · an alias that resolved to a DIFFERENT actual model → that actual must itself be approved, else review;
 *   · an unapproved model can NEVER authorize a payout, even if its brief says PAY at confidence 1.0.
 * The existing deterministic evidence + money gates are untouched — this only ever SUBTRACTS (turns a
 * would-pay into a review), so it cannot cause a wrong payout.
 *
 * Adding a model here REQUIRES re-running the promotion battery for it: P-JUDGE (≥3 runs, wrong-autopay
 * 0) + the live red-team on that exact model. This is why the fallback (deepseek) is intentionally absent
 * until it passes.
 */
import type { DecisionBrief } from "./brain-core";

/** Bump when the approved set changes — recorded on the block journal for audit. */
export const MODEL_POLICY_VERSION = "autopay-models-v1";

export const AUTOPAY_APPROVED_MODELS: ReadonlySet<string> = new Set<string>([
  "google/gemini-3.1-flash-lite-preview", // current prod primary — red-team + P-JUDGE passed
  "anthropic/claude-haiku-4-5", // P-JUDGE bake-off (0 wrong-autopay) + red-team passed
]);

/** True only for a non-empty, exactly-canonical approved model identity. Null/unknown → false. */
export function isApprovedJudgeModel(model: string | null | undefined): boolean {
  return !!model && AUTOPAY_APPROVED_MODELS.has(model);
}

/**
 * The model-approval gate, applied AFTER the autopilot gate returns pay. `gatePay` is the existing gate's
 * decision (all the current conditions: autopilot, pending, engine llm, recommendation pay, confidence,
 * fraud, mainnet). This adds ONE conjunct: the actual judge model must be approved. Pure + deterministic.
 */
export function judgeModelGate(
  brief: Pick<DecisionBrief, "model">,
  gatePay: boolean,
): { pay: boolean; blocked: "judge_model_unapproved" | null; approvedModel: boolean } {
  const approvedModel = isApprovedJudgeModel(brief.model);
  if (gatePay && !approvedModel) return { pay: false, blocked: "judge_model_unapproved", approvedModel };
  return { pay: gatePay, blocked: null, approvedModel };
}
