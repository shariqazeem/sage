/**
 * The autopay-approved JUDGE POLICY-IDENTITY — deterministic pipeline code, never a prompt.
 *
 * An autopay is authorized ONLY when the FULL identity that produced the brief is on this explicit,
 * versioned allowlist. The identity is four parts, ALL stamped on the brief by callProvider:
 *   · the provider HOST that actually answered (`brief.provider`);
 *   · the ACTUAL canonical model that decided (`brief.model` — not the requested env var);
 *   · the payout PROMPT version (`brief.promptVersion` = PAYOUT_PROMPT_VERSION at decision time);
 *   · the money-path PARSER version (`brief.parserVersion` = PARSER_POLICY_VERSION at decision time).
 *
 * Binding all four — not just the model string — closes the gap where a prompt or parser change silently
 * inherits a model's old approval: changing SYSTEM_PROMPT or the money parse bumps its version, the
 * stamped identity no longer matches any approved combination, and autopay falls to MANUAL REVIEW until
 * that exact combination is re-evaluated (P-JUDGE 0 wrong-autopay + live red-team) and re-added below. So:
 *   · an approved (provider, model, prompt, parser) + a qualifying brief → continues through the gates;
 *   · a FALLBACK model / different provider / bumped prompt / bumped parser not independently approved → review;
 *   · missing/unknown provenance (null model, or an unstamped legacy brief) → review;
 *   · an unapproved identity can NEVER authorize a payout, even if its brief says PAY at confidence 1.0.
 * The existing deterministic evidence + money gates are untouched — this only ever SUBTRACTS (turns a
 * would-pay into a review), so it cannot cause a wrong payout.
 *
 * Adding an identity here REQUIRES re-running the promotion battery for that EXACT combination: P-JUDGE
 * (≥3 runs, wrong-autopay 0) through the production path + the live red-team on that model. This is why
 * the fallback (deepseek) and any not-yet-evaluated (model, prompt, parser) combination are absent.
 */
import type { DecisionBrief } from "./brain-core";

/** Bump when the approved identity set or its shape changes — recorded on the block journal for audit. */
export const MODEL_POLICY_VERSION = "autopay-policy-v1";

/** The four-part policy identity an autopay is approved against. */
export interface JudgeIdentity {
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  parserVersion: string | null;
}

/** Canonical, comparable key for an identity. Any null component yields a key no approved entry has. */
export function identityKey(id: JudgeIdentity): string {
  return `${id.provider ?? "∅"}|${id.model ?? "∅"}|${id.promptVersion ?? "∅"}|${id.parserVersion ?? "∅"}`;
}

/**
 * The model-only allowlist — the set of canonical models that have EVER passed the promotion battery.
 * Kept for messaging + the model-membership helper; the real autopay gate uses the full identity below,
 * which additionally pins the provider host and the prompt + parser versions each model was evaluated at.
 */
export const AUTOPAY_APPROVED_MODELS: ReadonlySet<string> = new Set<string>([
  "google/gemini-3.1-flash-lite-preview", // current prod primary — red-team + P-JUDGE passed
  "anthropic/claude-haiku-4-5", // P-JUDGE bake-off (0 wrong-autopay) + red-team passed
]);

/**
 * The EXACT (provider, model, prompt, parser) combinations approved for autopay. Each line is one
 * combination that passed the promotion battery as a whole. The prompt/parser version literals here are
 * the PINNED evaluated values — when the LIVE PAYOUT_PROMPT_VERSION / PARSER_POLICY_VERSION are bumped
 * (because the prompt or money parse changed), the stamped brief no longer matches until the new
 * combination is re-evaluated and its line is added/updated here.
 */
const APPROVED_IDENTITIES: ReadonlySet<string> = new Set<string>([
  identityKey({ provider: "api.commonstack.ai", model: "google/gemini-3.1-flash-lite-preview", promptVersion: "payout-v1", parserVersion: "payout-parse-v2" }),
  identityKey({ provider: "api.commonstack.ai", model: "anthropic/claude-haiku-4-5", promptVersion: "payout-v1", parserVersion: "payout-parse-v2" }),
]);

/** True only for a non-empty, exactly-canonical approved model identity. Null/unknown → false. A weaker
 *  check than the identity gate (model membership only) — used for messaging + tests, never for a payout. */
export function isApprovedJudgeModel(model: string | null | undefined): boolean {
  return !!model && AUTOPAY_APPROVED_MODELS.has(model);
}

/** True only when the FULL four-part identity is an approved, evaluated combination. */
export function isApprovedJudgeIdentity(id: JudgeIdentity): boolean {
  return APPROVED_IDENTITIES.has(identityKey(id));
}

/** Read the policy identity off a brief (the provenance callProvider stamped). */
export function identityOf(brief: Pick<DecisionBrief, "provider" | "model" | "promptVersion" | "parserVersion">): JudgeIdentity {
  return {
    provider: brief.provider ?? null,
    model: brief.model ?? null,
    promptVersion: brief.promptVersion ?? null,
    parserVersion: brief.parserVersion ?? null,
  };
}

/**
 * The policy-identity gate, applied AFTER the autopilot gate returns pay. `gatePay` is the existing
 * gate's decision (all the current conditions: autopilot, pending, engine llm, recommendation pay,
 * confidence, fraud, mainnet). This adds ONE conjunct: the actual judge IDENTITY must be approved. Pure +
 * deterministic. `approvedModel` reports the weaker model-membership fact for the audit line.
 */
export function judgeIdentityGate(
  brief: Pick<DecisionBrief, "provider" | "model" | "promptVersion" | "parserVersion">,
  gatePay: boolean,
): { pay: boolean; blocked: "judge_identity_unapproved" | null; approvedIdentity: boolean; approvedModel: boolean } {
  const identity = identityOf(brief);
  const approvedIdentity = isApprovedJudgeIdentity(identity);
  const approvedModel = isApprovedJudgeModel(identity.model);
  if (gatePay && !approvedIdentity) return { pay: false, blocked: "judge_identity_unapproved", approvedIdentity, approvedModel };
  return { pay: gatePay, blocked: null, approvedIdentity, approvedModel };
}
