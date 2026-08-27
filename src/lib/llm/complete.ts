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

import { outputBudget, profileFor } from "./provider-profile";
import { stripReasoningPrefix } from "./reasoning";

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

/**
 * A LANE is one job Sage gives a model. Each lane can run on its OWN provider — key, base URL and
 * model together — so mission design can sit on a sponsored flat-rate provider while judgment stays
 * on a tuned one, and either can move without touching the other or editing code.
 *
 * Before this existed only PAYOUT and CONCIERGE could pick a provider, because each hand-rolled its
 * own resolver. Every other lane could override the MODEL NAME but not the key, so it was pinned to
 * whatever provider the shared chain pointed at — which is how mission design and the observation
 * judge ended up stranded on a metered key while the rest of the app ran on a sponsored one.
 */
export type Lane = "PAYOUT" | "CONCIERGE" | "MISSION" | "OBS_JUDGE" | "VISION";

/**
 * A lane's own provider, or null when it is not FULLY configured.
 *
 * All three vars are required together — the same opt-in rule the payout lane has always used, and
 * the reason for it is not tidiness: a half-configured lane would splice one provider's key onto
 * another provider's endpoint, which authenticates as nobody and fails at the worst moment rather
 * than at boot. Partial config is therefore treated as ABSENT, and the lane inherits the shared
 * chain unchanged.
 */
export function laneProvider(lane: Lane): ResolvedProvider | null {
  const key = process.env[`${lane}_API_KEY`]?.trim();
  const rawBase = process.env[`${lane}_BASE_URL`]?.trim();
  const model = process.env[`${lane}_MODEL`]?.trim();
  if (!key || !rawBase || !model) return null;
  const base = rawBase.replace(/\/+$/, "");
  return { endpoint: `${base}/chat/completions`, key, model, host: hostOf(base) };
}

/**
 * Resolve the provider for a call, or null when no key is set (caller degrades honestly).
 *
 * Precedence: the lane's own fully-configured provider → the shared chain. Callers that pass no
 * lane behave exactly as before.
 */
export function resolveLlm(modelOverride?: string, lane?: Lane): ResolvedProvider | null {
  if (lane) {
    const own = laneProvider(lane);
    // An explicit per-call model override still wins over the lane's default model, so a caller
    // that asks for a specific model keeps getting it — on the lane's provider.
    if (own) return modelOverride?.trim() ? { ...own, model: modelOverride.trim() } : own;
  }
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
  /** structural facts about a REFUSED payload — never its content. See {@link contentStructure}. */
  contentStructure?: Record<string, unknown> | null;
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
  declare contentStructure?: Record<string, unknown> | null;
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
 * explicitly-normal ("stop") completion whose content is a JSON object — bare, or inside a single
 * markdown fence wrapping the whole payload (see {@link unwrapLoneFence}). It NEVER extracts braces
 * from prose, drops trailing commas, appends delimiters, or calls repairJson: a non-conforming
 * response fails closed so a truncated/mangled/tool-call/refused reply can never be salvaged into a
 * plan.
 */
/**
 * A MARKDOWN FENCE IS NOT A MALFORMATION.
 *
 * `parseStrict` refused any content that did not start with `{`, fences included. That is the right
 * instinct for prose, arrays, truncation and tool calls — and the wrong one for a complete JSON
 * object the gateway happened to wrap in ```json. Measured on prod (2026-08-15): the grounded
 * architect returned `finish_reason: "stop"`, HTTP 200, 4,168 completion tokens, shape "fenced" —
 * and every inspection since 13 Aug fell back to the LEGACY planner, which has no goal journey. The
 * founder kept getting generic "verify the page communicates X" missions and no amount of rewriting
 * their goal could have helped, because the planner that reads the goal was never running.
 *
 * So: unwrap EXACTLY ONE fence around the whole payload, and change nothing else. Everything the
 * strictness exists for still fails closed — a non-"stop" finish, prose around the object, an array,
 * a tool call, a refusal, any malformed JSON, a fence that does not enclose the entire content. The
 * strictness lives in the schema gate, which is untouched; this only reads an equivalent shape.
 */
export function unwrapLoneFence(trimmed: string): string {
  if (!trimmed.startsWith("```")) return trimmed;
  const nl = trimmed.indexOf("\n");
  if (nl === -1) return trimmed; // a one-line ```...``` is not a fenced document
  const opener = trimmed.slice(3, nl).trim();
  // only a bare fence or a language tag may open it — never ``` followed by prose
  if (opener !== "" && !/^[a-z0-9_-]{1,12}$/i.test(opener)) return trimmed;
  const rest = trimmed.slice(nl + 1);
  const close = rest.indexOf("```");
  // No closing fence: the remainder IS the payload. finish_reason === "stop" has already ruled out
  // truncation one check earlier, so a model that stopped normally wrote all it meant to write.
  if (close === -1) return rest.trim();
  // EXACTLY ONE fenced block, or nothing. A second block means two candidate answers and no
  // principled way to choose — that is the ambiguity the strictness exists for, so it fails closed.
  // Trailing commentary after the ONE block is not ambiguity: measured 2026-08-15, the architect
  // returned a 2,241-char reply that was ```json{…}``` followed by markdown notes (fenceCount 2,
  // lastChar "*"), and refusing it dropped a complete, correct plan on the floor.
  if (rest.indexOf("```", close + 3) !== -1) return trimmed;
  return rest.slice(0, close).trim();
}

/**
 * The STRUCTURE of a failed payload — never its content.
 *
 * Two fence fixes were shipped on guesses because a strict failure recorded only a coarse shape
 * ("fenced") and the raw text is deliberately not stored (it can carry inspected-page content). These
 * are structural booleans and lengths: enough to name the exact branch that refused a response,
 * impossible to reconstruct a single character of it from.
 */
export function contentStructure(content: string | null | undefined): Record<string, unknown> {
  const t = (content ?? "").trim();
  const nl = t.indexOf("\n");
  const opener = t.startsWith("```") && nl > 0 ? t.slice(3, nl).trim() : null;
  return {
    length: t.length,
    startsWithFence: t.startsWith("```"),
    endsWithFence: t.endsWith("```"),
    // the opener token only when it is already a safe short tag; anything else is reported by class
    openerToken: opener === null ? null : /^[a-z0-9_-]{1,12}$/i.test(opener) ? opener.toLowerCase() : "other",
    fenceCount: (t.match(/```/g) ?? []).length,
    firstChar: t.slice(0, 1),
    lastChar: t.slice(-1),
    ...(() => {
      const u = unwrapLoneFence(t);
      return {
        unwrappedIsObject: u.startsWith("{") && u.endsWith("}"),
        unwrappedLength: u.length,
        unwrappedFirstChar: u.slice(0, 1),
        unwrappedLastChar: u.slice(-1),
        // whether unwrapping changed anything at all — separates "refused to unwrap" from
        // "unwrapped, and what came out still is not an object".
        unwrapped: u.length !== t.length,
      };
    })(),
  };
}

/**
 * ONE COMPLETE OBJECT, WITH PROSE AROUND IT.
 *
 * Same principle as {@link unwrapLoneFence}: a wrapper is not a malformation. Measured on prod
 * 2026-08-16 — a real founder pointed Sage at their product, waited four minutes, and got "Sage's
 * reviewer returned an unusable response" because the model wrote a sentence before its JSON
 * (`architectContentShape: "prose_wrapped"`). The plan itself was complete and correct.
 *
 * Retrying does not rescue this: the gateway's shape bias is per-PROMPT, so the same prompt returns
 * the same shape. The answer is to read the equivalent shape and keep the strictness in the gate.
 *
 * Deliberately narrow, because prose is where ambiguity actually lives. Exactly ONE balanced
 * top-level `{...}` span may exist in the whole content; two candidate objects, or an unbalanced
 * one, is refused. Braces inside JSON strings are tracked so a `{` in a quoted value cannot
 * unbalance the scan, and the extracted span must still parse and still be an object.
 */
export function extractLoneObject(trimmed: string): string {
  if (trimmed.startsWith("{")) return trimmed;
  // An ARRAY is not an object with prose around it — it is the wrong answer, and it stays refused.
  // Without this, `[{"a":1}]` would have one balanced span extracted out of it and quietly pass.
  if (trimmed.startsWith("[")) return trimmed;
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  const spans: string[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      if (depth === 0) return trimmed; // unbalanced — refuse
      depth--;
      if (depth === 0 && start >= 0) {
        spans.push(trimmed.slice(start, i + 1));
        if (spans.length > 1) return trimmed; // two candidate answers — refuse
      }
    }
  }
  if (depth !== 0 || spans.length !== 1) return trimmed;
  return spans[0];
}

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
  // Remove the reasoning block first — it is framing, not answer, and a model that quotes JSON while
  // thinking otherwise presents TWO top-level objects, which extractLoneObject rightly refuses.
  // Strictness is untouched: stripReasoningPrefix removes exactly ONE leading CLOSED <think> block,
  // so an UNCLOSED (truncated) one survives and still fails the parse, as it must.
  const trimmed = extractLoneObject(unwrapLoneFence(stripReasoningPrefix(content).trim()));
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) throw new Error("llm_strict_not_object"); // prose/arrays still refused
  const json: unknown = JSON.parse(trimmed); // throws on ANY malformation (trailing comma, truncation) — no repair
  if (json === null || typeof json !== "object" || Array.isArray(json)) throw new Error("llm_strict_not_object");
  return { json, finishReason };
}

/**
 * ONE JSON completion. Throws on any failure (bad status, empty, unparseable). The
 * caller owns retry / fallback / honest degradation — this never fabricates output.
 */
/**
 * ONE LLM REQUEST AT A TIME.
 *
 * The gateway key is capped at a single in-flight request — it answers a second one with
 * `429 {"code":"rate_limit_exceeded","message":"Access key quota exceeded (cap 1)"}`. Everything
 * shares that one key: the Telegram concierge, the mission architect and critic, the field test's
 * vision pass, and judging. `LLM_FALLBACK_API_KEY` is the SAME key on this deployment, so failover
 * lands on the identical quota and buys nothing.
 *
 * Measured 23 Aug: an inspection died `schema_mismatch` after 603s because a founder was chatting
 * with the bot while it ran. The same goal, run with nothing else in flight, produced four good
 * missions. The work was never wrong; two callers were fighting over one slot.
 *
 * Concurrency here was always an illusion, so queueing costs no throughput and removes the
 * collisions this process causes itself. It cannot help against a caller outside this process,
 * and it deliberately does not swallow errors — a failed call releases the slot and propagates.
 */
let llmChain: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = llmChain.then(fn, fn);
  llmChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

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
  /** run this call on a lane's own provider when that lane is fully configured (see `Lane`). */
  lane?: Lane;
}): Promise<LlmComplete> {
  const p = resolveLlm(opts.model, opts.lane);
  if (!p) throw new Error("llm_not_configured");
  const profile = profileFor(p.model, p.endpoint);
  const started = Date.now();
  const policy: ParsePolicy = opts.parsePolicy ?? "repair";
  const schemaName = opts.responseSchema?.name ?? null;
  const controller = new AbortController();
  // A reasoning model costs more SECONDS, not just more tokens — the mission architect measured
  // 63-151s per call on MiniMax against a 90s default, so a correct token budget alone would still
  // have been aborted. An explicit LLM_TIMEOUT_MS always wins; otherwise take the provider's own.
  const budgetMs = process.env.LLM_TIMEOUT_MS ? TIMEOUT_MS : Math.max(TIMEOUT_MS, profile.timeoutMs);
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const res = await oneAtATime(() => fetch(p.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: p.model,
        temperature: opts.temperature ?? 0.2,
        /**
         * PROVIDER-AWARE BUDGET. `maxTokens` is what the ANSWER needs; the profile adds whatever
         * this provider spends before the answer starts. Every caller became portable the moment
         * this lived here instead of at each call site — the mission architect asks for 4200 and
         * gets 4200 of ANSWER on a reasoning model, rather than 4200 minus a stochastic think
         * block, which truncates the JSON it was in the middle of writing.
         */
        max_tokens: outputBudget(opts.maxTokens ?? 3500, profile),
        response_format: opts.responseSchema
          ? { type: "json_schema", json_schema: { name: opts.responseSchema.name, strict: true, schema: opts.responseSchema.schema } }
          : { type: "json_object" },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    }));
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
          parsePolicy: "strict", responseSchemaName: schemaName, contentShape: classifyContentShape(choice0?.message?.content),
          contentStructure: contentStructure(choice0?.message?.content), retryAfterMs: null,
        });
      }
    } else {
      // DEFAULT "repair" — extract → JSON.parse → bounded structural repair.
      finishReason = data.choices?.[0]?.finish_reason ?? null;
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("llm_empty");
      // The reasoning block is framing, not answer, and it must go BEFORE extraction — MEASURED
      // 2026-08-27 on play2048: a 25,430-char <think> block contained its own ```json fence (the
      // model drafting), and extractJson takes the FIRST fence, so a COMPLETE answer
      // (finish_reason "stop") was discarded in favour of the model's scratch work. Intermittent by
      // nature: it depends on whether the model happened to quote JSON while thinking.
      const extracted = extractJson(stripReasoningPrefix(content));
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
