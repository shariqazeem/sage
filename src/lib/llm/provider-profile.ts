/**
 * PROVIDER PROFILES — what each model family does differently, in ONE place.
 *
 * Sage runs on whatever LLM is cheapest, fastest or sponsored this month, and that changed three
 * times in a fortnight. Every switch used to break something new, because provider behaviour was
 * hardcoded at each call site: eight different max_tokens (400, 600, 3500, 8000…), three separate
 * bits of `<think>` handling, four different response_format decisions. Each fix was a patch, and
 * the next switch broke a different one.
 *
 * The portable rule: A CALLER DECLARES WHAT ITS ANSWER NEEDS. The profile knows what the provider
 * adds on top. Swapping models then means editing this file, not auditing the codebase.
 *
 * Everything here is MEASURED, not assumed — the numbers cite the run that produced them.
 */

export interface ProviderProfile {
  /** human id for logs/telemetry. */
  id: string;
  /**
   * Emits a leading `<think>…</think>` block inside `content` that must be stripped before the
   * text is shown to a person or parsed. MiniMax-M3 does this on EVERY call and ignores
   * response_format while doing it (measured 2026-08-25 and again 2026-08-28, when the first
   * Telegram reply after the switch opened with Sage's monologue about the founder).
   */
  emitsReasoningPrefix: boolean;
  /**
   * Tokens the provider spends BEFORE the answer starts — reasoning, preamble, tool-call framing.
   * Added to whatever the caller says its answer needs. MiniMax-M3's reasoning is stochastic: the
   * SAME payload measured 1756 / 1884 / 2766 completion tokens, so this is sized above the worst
   * observed, not the average. Under-sizing it does not shorten the answer, it TRUNCATES it —
   * which for a tool call means invalid JSON, not a shorter reply.
   */
  reasoningOverheadTokens: number;
  /** Strictest structured-output mode the provider actually honours. */
  jsonMode: "schema" | "object" | "none";
}

/** Conservative default for an unknown provider: assume it may reason, assume weak JSON support. */
const DEFAULT_PROFILE: ProviderProfile = {
  id: "unknown",
  emitsReasoningPrefix: true,
  reasoningOverheadTokens: 3_000,
  jsonMode: "object",
};

const PROFILES: { match: (model: string, base: string) => boolean; profile: ProviderProfile }[] = [
  {
    // MiniMax reasoning models — the current primary for both the concierge and the payout brain.
    match: (m, b) => /minimax/i.test(m) || /minimax\.io/i.test(b),
    profile: {
      id: "minimax",
      emitsReasoningPrefix: true,
      reasoningOverheadTokens: 3_000,
      jsonMode: "object", // ignores json_schema; strictness stays in our own parser + gate
    },
  },
  {
    // Anthropic models served through an OpenAI-compatible gateway (CommonStack today).
    match: (m) => /claude|anthropic/i.test(m),
    profile: {
      id: "anthropic-compatible",
      emitsReasoningPrefix: false,
      reasoningOverheadTokens: 0,
      jsonMode: "object",
    },
  },
  {
    match: (m) => /gemini|flash/i.test(m),
    profile: {
      id: "gemini-compatible",
      // MEASURED (grounded-architect live smoke): json_object broke strict parsing where
      // json_schema worked, so this family is the one place schema mode is worth asking for.
      emitsReasoningPrefix: false,
      reasoningOverheadTokens: 0,
      jsonMode: "schema",
    },
  },
];

export function profileFor(model: string | null | undefined, baseUrl: string | null | undefined): ProviderProfile {
  const m = (model ?? "").trim();
  const b = (baseUrl ?? "").trim();
  if (!m && !b) return DEFAULT_PROFILE;
  return PROFILES.find((p) => p.match(m, b))?.profile ?? DEFAULT_PROFILE;
}

/**
 * The completion budget to request, given what the ANSWER needs.
 *
 * Callers must pass the size of the answer they actually want — not a number tuned for whichever
 * model happened to be configured that week. The provider's own overhead is added here, so moving
 * to a reasoning model cannot silently truncate anyone.
 */
export function outputBudget(answerTokens: number, profile: ProviderProfile): number {
  const answer = Math.max(1, Math.round(answerTokens));
  return answer + profile.reasoningOverheadTokens;
}
