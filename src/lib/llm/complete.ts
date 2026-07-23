import "server-only";

/**
 * A small, provider-agnostic JSON completion helper shared by Sage's non-Deputy
 * brains (the Mission Brain, product-map synthesis). It reuses the SAME OpenAI-
 * compatible provider configuration as the Payout Deputy (LLM_BASE_URL / LLM_API_KEY /
 * LLM_MODEL, with the legacy COMMONSTACK_* as fallback) but does NOT touch the frozen
 * `brain.ts`. It forces JSON output, bounds latency, and NEVER logs the key or the raw
 * prompt. Returns the parsed JSON object + provenance, or throws for the caller to
 * retry / degrade honestly.
 */

const DEFAULT_BASE_URL = "https://api.commonstack.ai/v1";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
// Mission design generates up to ~4200 tokens of JSON from a large (field-tested) product map, so
// 45s was too tight on a lite model + gateway latency → provider_timeout. Give it real headroom;
// env-tunable for slow providers/sites.
const TIMEOUT_MS = Math.max(20_000, Number(process.env.LLM_TIMEOUT_MS) || 90_000);

export interface LlmComplete {
  /** the parsed JSON object the model returned. */
  json: unknown;
  /** the model Sage REQUESTED (resolved from override/env). */
  model: string;
  provider: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  /** parse provenance — which policy parsed this response, the provider finish_reason, and whether the
   *  tolerant repair rung was used. Optional so existing constructors/mocks stay valid. */
  parsePolicy?: "repair" | "strict";
  finishReason?: string | null;
  repaired?: boolean;
  /** the model the PROVIDER reported using (may differ from the requested `model`); null when absent. */
  responseModel?: string | null;
}

export type ParsePolicy = "repair" | "strict";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

interface ResolvedProvider {
  endpoint: string;
  key: string;
  model: string;
  host: string;
}

/** Resolve the configured provider, or null when no key is set (caller degrades). */
export function resolveLlm(modelOverride?: string): ResolvedProvider | null {
  const key = process.env.LLM_API_KEY?.trim() || process.env.COMMONSTACK_API_KEY?.trim();
  if (!key) return null;
  const base = (process.env.LLM_BASE_URL?.trim() || process.env.COMMONSTACK_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = modelOverride?.trim() || process.env.LLM_MODEL?.trim() || process.env.DEPUTY_MODEL?.trim() || DEFAULT_MODEL;
  return { endpoint: `${base}/chat/completions`, key, model, host: hostOf(base) };
}

export function llmModel(): string {
  return resolveLlm()?.model ?? DEFAULT_MODEL;
}
export function llmConfigured(): boolean {
  return resolveLlm() !== null;
}

/** Strip common ```json fences and trailing prose the odd model wraps around JSON. */
function extractJson(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : content;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  return first >= 0 && last > first ? body.slice(first, last + 1) : body.trim();
}

/**
 * Bounded structural repair of syntactically-malformed JSON — trailing commas and an
 * UNTERMINATED tail (a truncated completion): close any open strings/arrays/objects.
 * It only rebalances delimiters; it never invents content. Returns the parsed value or
 * null. This is the "repair" rung of the Mission Brain recovery ladder.
 */
function repairJson(raw: string): unknown {
  const cleaned = raw.replace(/,(\s*[}\]])/g, "$1"); // drop trailing commas
  try {
    return JSON.parse(cleaned);
  } catch {
    /* try to close a truncated tail */
  }
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const ch of cleaned) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let patched = cleaned;
  if (inStr) patched += '"';
  patched = patched.replace(/,\s*$/, "");
  while (stack.length) patched += stack.pop();
  try {
    return JSON.parse(patched.replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return null;
  }
}

interface ChatResponse {
  /** the model the provider actually served (OpenAI-compatible gateways echo this). */
  model?: string;
  choices?: {
    message?: { content?: string; refusal?: string | null; tool_calls?: unknown[] };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** The coarse SHAPE of a completion's content — enum only, never the text itself (leak-safe telemetry). */
export type ContentShape = "bare_object" | "fenced" | "prose_wrapped" | "array" | "empty" | "other" | "unknown";
export function classifyContentShape(content: string | null | undefined): ContentShape {
  if (content == null) return "unknown";
  const t = content.trim();
  if (t === "") return "empty";
  if (t.startsWith("```")) return "fenced";
  if (t.startsWith("[")) return "array";
  if (t.startsWith("{")) return t.endsWith("}") ? "bare_object" : "other";
  if (t.includes("{")) return "prose_wrapped";
  return "other";
}

export interface LlmCompletionErrorFields {
  code: string;
  httpStatus: number | null;
  provider: string | null;
  requestedModel: string | null;
  responseModel: string | null;
  finishReason: string | null;
  latencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  parsePolicy: ParsePolicy | null;
  responseSchemaName: string | null;
  contentShape: ContentShape;
  retryAfterMs: number | null;
}

/**
 * A sanitized completion failure. It carries provenance so a failed model can be measured FAIRLY (served
 * model, usage, latency, finish reason, the response SHAPE) — but it NEVER carries any raw response text.
 * `message === code`, so existing `.message`-based classification keeps working.
 */
export class LlmCompletionError extends Error implements LlmCompletionErrorFields {
  declare code: string;
  declare httpStatus: number | null;
  declare provider: string | null;
  declare requestedModel: string | null;
  declare responseModel: string | null;
  declare finishReason: string | null;
  declare latencyMs: number | null;
  declare promptTokens: number | null;
  declare completionTokens: number | null;
  declare parsePolicy: ParsePolicy | null;
  declare responseSchemaName: string | null;
  declare contentShape: ContentShape;
  declare retryAfterMs: number | null;
  constructor(f: LlmCompletionErrorFields) {
    super(f.code);
    this.name = "LlmCompletionError";
    Object.assign(this, f);
  }
}

function parseRetryAfterMs(h: string | null): number | null {
  if (!h) return null;
  const secs = Number(h.trim());
  return Number.isFinite(secs) ? Math.round(secs * 1000) : null;
}

/**
 * STRICT parse for the grounded-architect boundary — the same discipline the money path uses
 * (deputy/brain.ts), applied to a non-money generation path. The raw provider response must be a SINGLE,
 * explicitly-normal ("stop") completion whose trimmed content is a bare JSON object. It NEVER strips
 * fences, extracts braces from prose, drops trailing commas, appends delimiters, or calls repairJson: a
 * non-conforming response fails closed so a truncated/mangled/tool-call/refused reply can never be
 * salvaged into a plan.
 */
function parseStrict(data: ChatResponse): { json: unknown; finishReason: string } {
  const choices = data.choices ?? [];
  if (choices.length !== 1) throw new Error("llm_strict_choice_count");
  const choice = choices[0];
  const finishReason = choice.finish_reason;
  if (finishReason == null) throw new Error("llm_strict_finish_absent"); // missing → fail closed
  if (finishReason !== "stop") throw new Error(`llm_strict_finish_${finishReason}`.slice(0, 48)); // length/content_filter/tool_calls/unknown
  const message = choice.message;
  if (!message) throw new Error("llm_strict_no_message");
  if (message.refusal != null && String(message.refusal).trim() !== "") throw new Error("llm_strict_refusal");
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) throw new Error("llm_strict_tool_calls");
  const content = message.content;
  if (!content || content.trim() === "") throw new Error("llm_empty");
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) throw new Error("llm_strict_not_object"); // no fences/prose/arrays
  const json: unknown = JSON.parse(trimmed); // throws on ANY malformation (trailing comma, truncation) — no repair
  if (json === null || typeof json !== "object" || Array.isArray(json)) throw new Error("llm_strict_not_object");
  return { json, finishReason };
}

/**
 * ONE JSON completion. Throws on any failure (bad status, empty, unparseable). The
 * caller owns retry / fallback / honest degradation — this never fabricates output.
 */
export async function llmCompleteJson(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  model?: string;
  temperature?: number;
  /** "repair" (default — unchanged tolerant parse for legacy callers) | "strict" (fail-closed, no salvage). */
  parsePolicy?: ParsePolicy;
  /** provider-native structured output. When supplied, sends response_format json_schema (strict:true) so
   *  the model is CONSTRAINED to the schema during generation. It never weakens Sage's receiving parser. */
  responseSchema?: { name: string; schema: Record<string, unknown> };
}): Promise<LlmComplete> {
  const p = resolveLlm(opts.model);
  if (!p) throw new Error("llm_not_configured");
  const started = Date.now();
  const policy: ParsePolicy = opts.parsePolicy ?? "repair";
  const schemaName = opts.responseSchema?.name ?? null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(p.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: p.model,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 3500,
        response_format: opts.responseSchema
          ? { type: "json_schema", json_schema: { name: opts.responseSchema.name, strict: true, schema: opts.responseSchema.schema } }
          : { type: "json_object" },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
    if (!res.ok) {
      // bad status (429 quota, 400 schema-incompat, auth/billing) → sanitized error, no body text.
      throw new LlmCompletionError({
        code: `llm_status_${res.status}`, httpStatus: res.status, provider: p.host, requestedModel: p.model,
        responseModel: null, finishReason: null, latencyMs: Date.now() - started, promptTokens: null, completionTokens: null,
        parsePolicy: policy, responseSchemaName: schemaName, contentShape: "unknown", retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after")),
      });
    }
    const data = (await res.json()) as ChatResponse;
    let json: unknown;
    let finishReason: string | null;
    let repaired = false;
    if (policy === "strict") {
      const choice0 = data.choices?.[0];
      try {
        const strict = parseStrict(data); // fail-closed: no fence-strip / brace-extract / trailing-comma / repair
        json = strict.json;
        finishReason = strict.finishReason;
      } catch (e) {
        // a provider response arrived but strict parse rejected it → retain served-model/usage/latency/shape.
        throw new LlmCompletionError({
          code: e instanceof Error ? e.message : "llm_strict_failed", httpStatus: res.status, provider: p.host,
          requestedModel: p.model, responseModel: typeof data.model === "string" ? data.model : null,
          finishReason: choice0?.finish_reason ?? null, latencyMs: Date.now() - started,
          promptTokens: data.usage?.prompt_tokens ?? null, completionTokens: data.usage?.completion_tokens ?? null,
          parsePolicy: "strict", responseSchemaName: schemaName, contentShape: classifyContentShape(choice0?.message?.content), retryAfterMs: null,
        });
      }
    } else {
      // DEFAULT "repair" — byte-identical to before: extract → JSON.parse → bounded structural repair.
      finishReason = data.choices?.[0]?.finish_reason ?? null;
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("llm_empty");
      const extracted = extractJson(content);
      try {
        json = JSON.parse(extracted);
      } catch {
        // recovery rung: bounded structural repair before giving up.
        json = repairJson(extracted);
        if (json === null) throw new Error("llm_unparseable");
        repaired = true;
      }
    }
    return {
      json,
      model: p.model,
      provider: p.host,
      latencyMs: Date.now() - started,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      parsePolicy: policy,
      finishReason,
      repaired,
      responseModel: typeof data.model === "string" ? data.model : null,
    };
  } finally {
    clearTimeout(timer);
  }
}
