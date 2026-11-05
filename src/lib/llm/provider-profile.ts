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
  /**
   * Strictest structured-output mode the provider actually honours:
   *  - schema: json_schema when the caller has a schema, json_object otherwise;
   *  - schema_only: json_schema when the caller has a schema, NOTHING otherwise (json_object is refused);
   *  - object: json_object always (a schema is not honoured, so it is not asked for);
   *  - none: no response_format at all.
   */
  jsonMode: "schema" | "schema_only" | "object" | "none";
  /**
   * Does this model accept a sampling `temperature`? Current Claude models refuse it outright (400
   * "`temperature` is deprecated for this model", measured 5 Nov 2026 on Anthropic's endpoint), and
   * OpenAI's reasoning models accept only the default. Sending it is how a provider switch becomes an
   * outage, so it is sent only where it is known to be taken. The wire (wire.ts) also learns a refusal
   * at runtime, so an unknown provider costs one extra round trip, never a failed call.
   */
  acceptsTemperature: boolean;
  /**
   * Does the provider actually SEE images, or does it accept them and quietly ignore them?
   *
   * This is not pedantry. MiniMax-M3 answers a multimodal request with HTTP 200 and the text
   * "I don't actually see any image attached" (measured 2026-08-28) — so pointing the VISION lane
   * at it to save money would make Sage's eyes silently blind while every call still looked
   * successful. A capability that degrades loudly is recoverable; one that degrades silently
   * poisons everything downstream that trusts the observation.
   */
  multimodal: boolean;
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
  multimodal: false, // unknown provider: never ASSUME sight — assuming it is how eyes go blind quietly
  acceptsTemperature: true, // the wire learns a refusal at runtime and re-sends without it
};

/**
 * Claude models that think before they answer (adaptive thinking, on by default): the 4.6+ Opus and
 * Sonnet, and every 5.x model. Their thinking is billed as completion tokens and counts against
 * max_tokens, and none of them accepts a temperature.
 */
const ADAPTIVE_CLAUDE = /claude-(?:opus|sonnet|haiku|fable|mythos)-(?:4-[6-9]|[5-9])/i;

const PROFILES: { match: (model: string, base: string) => boolean; profile: ProviderProfile }[] = [
  {
    // Claude on Anthropic's OWN OpenAI-compatible endpoint. Measured 5 Nov 2026 on haiku/sonnet/opus 5.5:
    // - `temperature` is refused with a 400;
    // - response_format json_object is refused ("Input should be 'json_schema'");
    // - strict json_schema is honoured;
    // - with no response_format the answer is bare JSON (Opus at low effort fenced it once).
    // The fence is read by the parser.
    match: (_m, b) => /api\.anthropic\.com/i.test(b),
    profile: {
      id: "anthropic-direct",
      emitsReasoningPrefix: false,
      // Thinking is billed as completion tokens and fits inside max_tokens. A trivial JSON answer
      // spent ~150 tokens thinking (measured); a drafted job far more. Over-budgeting costs nothing.
      reasoningOverheadTokens: 4_000,
      jsonMode: "schema_only",
      timeoutMs: 120_000,
      multimodal: true,
      acceptsTemperature: false,
    },
  },
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
      // MEASURED AGAIN 2026-09-02 (P-GEN 46, count rule mb-v4.4): successful architect calls ran
      // 98-177s and two rows (plausible.io, allbirds.com) crossed 180s twice each and failed the
      // whole category as provider_timeout. A timeout must cover the TAIL of the job it guards,
      // not the median of an older, smaller one; the ladder still stops after two aborts.
      timeoutMs: 300_000,
      multimodal: false, // MEASURED: accepts image_url, returns 200, and reports seeing no image
      acceptsTemperature: true,
    },
  },
  {
    // Current Claude models (adaptive thinking) through an OpenAI-compatible gateway (CommonStack today).
    // Measured 5 Nov 2026 via CommonStack: sonnet/opus 5.5 answer bare JSON in every response_format mode
    // (the gateway translates json_object and strips temperature), in 2-5 s.
    match: (m) => ADAPTIVE_CLAUDE.test(m),
    profile: {
      id: "anthropic-adaptive",
      emitsReasoningPrefix: false,
      reasoningOverheadTokens: 4_000,
      jsonMode: "object",
      timeoutMs: 120_000,
      multimodal: true,
      acceptsTemperature: false,
    },
  },
  {
    // Older Anthropic models served through an OpenAI-compatible gateway (CommonStack: claude-haiku-4-5).
    match: (m) => /claude|anthropic/i.test(m),
    profile: {
      id: "anthropic-compatible",
      emitsReasoningPrefix: false,
      reasoningOverheadTokens: 0,
      jsonMode: "object",
      timeoutMs: 90_000,
      multimodal: true,
      acceptsTemperature: true,
    },
  },
  {
    // OpenAI's reasoning generation (gpt-5+, o-series): accepts only the default temperature and reasons
    // before it answers; json_schema is honoured.
    match: (m) => /(?:^|\/)(?:gpt-[5-9]|o[1-9])/i.test(m),
    profile: {
      id: "openai-reasoning",
      emitsReasoningPrefix: false,
      reasoningOverheadTokens: 4_000,
      jsonMode: "schema",
      timeoutMs: 120_000,
      multimodal: true,
      acceptsTemperature: false,
    },
  },
  {
    // DeepSeek V4 through CommonStack. Measured 5 Nov 2026: bare JSON in every mode, but 435 completion
    // tokens for a 204-character answer. It reasons where the answer cannot see it, and that is billed
    // inside max_tokens.
    match: (m) => /deepseek/i.test(m),
    profile: {
      id: "deepseek",
      emitsReasoningPrefix: false,
      reasoningOverheadTokens: 2_000,
      // json_schema was honoured in the same probe, and this model reached schema mode before it had a
      // profile of its own (it matched /flash/), so it keeps it.
      jsonMode: "schema",
      timeoutMs: 120_000,
      multimodal: false,
      acceptsTemperature: true,
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
      multimodal: true,
      acceptsTemperature: true,
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
export function outputBudget(answerTokens: number, profile: ProviderProfile, escalation = 0): number {
  const answer = Math.max(1, Math.round(answerTokens));
  return answer + Math.round(profile.reasoningOverheadTokens * ESCALATION[Math.min(escalation, ESCALATION.length - 1)]!);
}

/**
 * HOW FAR TO OPEN THE BUDGET, PER ATTEMPT.
 *
 * A fixed overhead cannot be right, because the reasoning block scales with the INPUT: play2048's
 * architect think block measured ~6,357 tokens, while a one-sentence page needs a fraction of that.
 * Sizing the constant for the worst case looked safe and was not — the model FILLS whatever budget
 * it is given (7.2k -> 7,199; 11.2k -> 11,199; 16k -> 15,998), so a worst-case constant made EVERY
 * call generate worst-case tokens. Measured on prod: one architect call took 157s and a
 * one-sentence website took 36 MINUTES to inspect.
 *
 * So the first attempt is sized for the typical case and only a real truncation
 * (finish_reason "length") buys more room. Fast common case, correct worst case, and the retry
 * ladder finally responds to the failure it is retrying — it varied temperature before, which
 * cannot fix a budget problem.
 */
const ESCALATION = [0.45, 1, 2] as const;
