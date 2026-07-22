/**
 * The completion adapter — preserves and classifies provider TERMINATION metadata for money-authorizing
 * LLM completions (Gate C item 2).
 *
 * The money path must NEVER infer a normal completion from a parseable body. A truncated response
 * (finish_reason "length"/"max_tokens") can still carry a syntactically complete PAY object; a filtered or
 * refused response can too. So a payout may be authorized ONLY when the provider EXPLICITLY signalled a
 * recognized normal completion. Absence or an unknown reason fails closed to manual review — we do not
 * loosen the gate to accommodate a provider that omits the metadata; the adapter preserves what the
 * provider actually sent, and the gate requires it to be explicitly normal.
 */

/** OpenAI-compatible chat-completions response, only the fields the money path reads. */
export interface ChatCompletionResponse {
  choices?: {
    message?: { content?: string | null; refusal?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** The preserved termination metadata of a single completion. */
export interface ProviderCompletion {
  content: string | null;
  /** the provider's actual finish_reason, verbatim (null if the provider omitted it). */
  finishReason: string | null;
  /** an explicit refusal string, if the provider surfaced one. */
  refusal: string | null;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Recognized NORMAL completion reasons for an OpenAI-compatible money completion. ONLY these may
 * authorize a payout. CommonStack / OpenAI signal a normal stop with exactly "stop". Adding another
 * marker (e.g. a gateway that normalizes to "end_turn") requires a VERIFIED live observation that the
 * gateway emits it for a complete response — never a speculative widening to accommodate assumed data.
 */
const NORMAL_FINISH: ReadonlySet<string> = new Set(["stop"]);

/** Reasons we explicitly recognize as ABNORMAL (for clearer diagnostics; the gate is the allow-list). */
const KNOWN_ABNORMAL_FINISH: ReadonlySet<string> = new Set([
  "length",
  "max_tokens",
  "content_filter",
  "tool_calls",
  "function_call",
]);

/** Extract + preserve the termination metadata of the first choice. Never throws. */
export function readCompletion(data: ChatCompletionResponse | null | undefined): ProviderCompletion {
  const choice = data?.choices?.[0];
  return {
    content: choice?.message?.content ?? null,
    finishReason: choice?.finish_reason ?? null,
    refusal: choice?.message?.refusal ?? null,
    promptTokens: data?.usage?.prompt_tokens ?? 0,
    completionTokens: data?.usage?.completion_tokens ?? 0,
  };
}

/** True ONLY when the provider explicitly signalled a recognized normal completion. Absent/unknown → false. */
export function isNormalCompletion(finishReason: string | null | undefined): boolean {
  return !!finishReason && NORMAL_FINISH.has(finishReason);
}

/** True for a reason we explicitly recognize as abnormal (truncation / filter / tool). Diagnostics only. */
export function isKnownAbnormalCompletion(finishReason: string | null | undefined): boolean {
  return !!finishReason && KNOWN_ABNORMAL_FINISH.has(finishReason);
}

/**
 * The single money-path admission decision for a completion's TERMINATION (independent of parsing the
 * body). Returns null when the completion may proceed to strict parsing, or a short machine reason why it
 * must FAIL CLOSED. A refusal, an absent finish_reason, a truncation, or any non-normal reason all fail.
 */
export function terminationRejectReason(c: ProviderCompletion): string | null {
  if (c.refusal) return "refusal";
  if (c.finishReason == null) return "finish_reason_absent";
  if (!isNormalCompletion(c.finishReason)) return `finish_reason_${c.finishReason}`;
  return null;
}
