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
  /**
   * Wall-clock a single completion may take. A reasoning model does not just cost more tokens, it
   * costs more SECONDS: the play2048 mission architect measured 63s at 7.2k tokens and 96-151s at
   * 12-16k, against a 90s default that would have killed the call regardless of budget.
   */
  timeoutMs: number;
}

/** Conservative default for an unknown provider: assume it may reason, assume weak JSON support. */
const DEFAULT_PROFILE: ProviderProfile = {
  id: "unknown",
  emitsReasoningPrefix: true,
  reasoningOverheadTokens: 7_000,
  jsonMode: "object",
  timeoutMs: 180_000,
};

const PROFILES: { match: (model: string, base: string) => boolean; profile: ProviderProfile }[] = [
  {
    // MiniMax reasoning models — the current primary for both the concierge and the payout brain.
    match: (m, b) => /minimax/i.test(m) || /minimax\.io/i.test(b),
    profile: {
      id: "minimax",
      emitsReasoningPrefix: true,
      // MEASURED, and revised UP on evidence. 3000 came from the payout brain's short briefs
      // (worst case 2766). The mission architect is a far bigger job and the think block scales
      // with it: on play2048 it measured 25,430 chars (~6,357 tokens) while the ANSWER was only
      // ~3,600 — so a 4200-answer budget plus 3000 truncated every attempt, and the architect
      // failed the whole category with `invalid_json`.
      reasoningOverheadTokens: 7_000,
      // json_schema is NOT honoured — measured directly: asked for {supported, reason} with
      // strict:true, it returned a <think> block, a markdown fence, and invented field names
      // (is_supported/reasoning). Strictness therefore stays in our own parser + the gate.
      jsonMode: "object",
      timeoutMs: 180_000, // measured 63-151s for one architect call
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
      timeoutMs: 90_000,
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
      timeoutMs: 90_000,
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
