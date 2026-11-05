import "server-only";
import { createHash } from "node:crypto";
import { profileFor, type ProviderProfile } from "./provider-profile";

/**
 * ONE WIRE FOR EVERY MODEL CALL.
 *
 * Sage talks to whichever OpenAI-compatible provider is cheapest, fastest or sponsored this month, and
 * every switch used to break somewhere new, because eight call sites each built their own request:
 * - each sent `temperature`;
 * - each chose its own `response_format`;
 * - all of them queued behind one global lock.
 *
 * Measured 5 Nov 2026, on the first try of Claude's own endpoint:
 * - `temperature` → 400 "deprecated for this model" on every current Claude model;
 * - `response_format: json_object` → 400 "Input should be 'json_schema'".
 *
 * Both are things Sage sent on every call, so that one switch would have taken down drafting, judging and
 * the concierge at once. This file is the single place a request is shaped and sent, so the next
 * provider is a configuration change and nothing more.
 *
 * Three things live here and nowhere else:
 *  1. SHAPE: what this provider/model accepts, from the profile, then from what the provider itself has
 *     refused at runtime. A 400 that names a parameter is learned for that model, once, and the request is
 *     re-sent without it immediately. An unknown provider cannot strand a founder over a parameter.
 *  2. CONCURRENCY: a bounded number of requests in flight per provider key, not one per process. The old
 *     lock existed for a key capped at one request (23 Aug). The same key took six in parallel on
 *     5 Nov, so the lock now only queues a founder's 3-second draft behind a 2-minute mission
 *     architect. A 429 that states its cap lowers the limit to that cap.
 *  3. PRIORITY: when a key is busy, the person who is WAITING goes first: the draft and the concierge,
 *     then judgment (a worker waiting to be paid), then background design.
 *
 * It never logs a key, a prompt or a provider's response body. It reads a 400's body only to classify
 * which parameter was refused, and throws the text away.
 */

export interface WireProvider {
  endpoint: string;
  key: string;
  model: string;
  host: string;
}

/** Who is waiting on this call. Interactive work jumps the queue; background design waits its turn. */
export type WirePriority = "interactive" | "judgment" | "background";
const RANK: Record<WirePriority, number> = { interactive: 0, judgment: 1, background: 2 };

// ───────────────────────────── 1. SHAPE ─────────────────────────────

/** What a provider has told us, at runtime, that it refuses for a model. Process-lifetime memory. */
interface Refused {
  temperature?: boolean;
  jsonObject?: boolean;
  responseFormat?: boolean;
  reasoningEffort?: boolean;
  /** a FORCED tool_choice ("required" / a named tool). Claude 5.5 refuses it (400), MiniMax ignores it. */
  forcedToolChoice?: boolean;
  /** the largest max_tokens this model accepts, read from its own refusal ("… must be <= 8192"). */
  maxTokensCap?: number;
}
const refused = new Map<string, Refused>();
const shapeKey = (p: Pick<WireProvider, "host" | "model">) => `${p.host}|${p.model}`;

/**
 * The response_format to ASK for, given the provider's strictest honoured mode and whether the caller
 * has a schema. `undefined` means: send none (the parser and the gate still enforce the shape).
 */
export function responseFormatFor(
  profile: ProviderProfile,
  schema: { name: string; schema: Record<string, unknown> } | undefined,
): Record<string, unknown> | undefined {
  const asSchema = schema ? { type: "json_schema", json_schema: { name: schema.name, strict: true, schema: schema.schema } } : undefined;
  switch (profile.jsonMode) {
    case "schema":
      return asSchema ?? { type: "json_object" };
    case "schema_only":
      return asSchema;
    case "object":
      return { type: "json_object" };
    case "none":
      return undefined;
  }
}

/**
 * json_object where the provider honours it, nothing where it refuses it (Anthropic's own endpoint).
 * For callers that deliberately want json_object, never a schema: the browser controller does, because
 * Flash-Lite ignores strict json_schema on multimodal calls and returns a bare enum.
 */
export function jsonObjectFormat(profile: ProviderProfile): Record<string, unknown> | undefined {
  return profile.jsonMode === "schema_only" || profile.jsonMode === "none" ? undefined : { type: "json_object" };
}

/**
 * The request body as THIS provider will accept it. Pure: the profile says what the model family
 * takes, and the runtime memory says what this exact provider/model has refused before.
 */
export function shapeRequest(p: Pick<WireProvider, "host" | "model">, profile: ProviderProfile, body: Record<string, unknown>): Record<string, unknown> {
  const r = refused.get(shapeKey(p)) ?? {};
  const out: Record<string, unknown> = { ...body };
  if (!profile.acceptsTemperature || r.temperature) delete out.temperature;
  if (r.reasoningEffort) delete out.reasoning_effort;
  // A forced tool choice the model refuses becomes "auto": the caller's guards still judge whether a
  // tool ran, which is what the force was for. Losing the force costs one corrective round; a 400 cost
  // the whole turn.
  if (r.forcedToolChoice && out.tool_choice !== undefined && out.tool_choice !== "auto" && out.tool_choice !== "none") out.tool_choice = "auto";
  if (r.maxTokensCap && typeof out.max_tokens === "number" && out.max_tokens > r.maxTokensCap) out.max_tokens = r.maxTokensCap;
  const rf = out.response_format as { type?: unknown } | undefined;
  if (rf) {
    if (r.responseFormat) delete out.response_format;
    else if (rf.type === "json_object" && r.jsonObject) delete out.response_format;
  }
  return out;
}

/**
 * Which parameter a 400/422 refused, read from the provider's own words, or null when the refusal
 * is about something else (a real schema error, a bad key) and re-sending would not help.
 */
export function refusedParameter(status: number, bodyText: string, sent: Record<string, unknown>): Exclude<keyof Refused, "maxTokensCap"> | null {
  if (status !== 400 && status !== 422) return null;
  const t = bodyText.slice(0, 4000).toLowerCase();
  if ("temperature" in sent && /temperature/.test(t)) return "temperature";
  if ("reasoning_effort" in sent && /reasoning_effort|reasoning effort/.test(t)) return "reasoningEffort";
  const tc = sent.tool_choice;
  if (tc !== undefined && tc !== "auto" && tc !== "none" && /tool_choice/.test(t)) return "forcedToolChoice";
  const rf = sent.response_format as { type?: unknown } | undefined;
  if (rf && /response_format|json_object|json_schema|structured output/.test(t)) {
    return rf.type === "json_object" ? "jsonObject" : "responseFormat";
  }
  return null;
}

function learnRefusal(p: Pick<WireProvider, "host" | "model">, what: Exclude<keyof Refused, "maxTokensCap">): void {
  const k = shapeKey(p);
  refused.set(k, { ...(refused.get(k) ?? {}), [what]: true });
  console.warn(`[llm-wire] ${p.host} ${p.model} refused ${what}; sending without it from now on`);
}

/**
 * The max_tokens ceiling a 400 states, or null. A judge asks for 16,000 tokens of room because a
 * reasoning model's length is stochastic (brain.ts). A model whose output is capped lower answers
 * that with a 400 naming its limit, and "every call fails" is not an acceptable way to learn it.
 */
export function statedMaxTokens(status: number, bodyText: string, sent: Record<string, unknown>): number | null {
  if (status !== 400 && status !== 422) return null;
  const asked = sent.max_tokens;
  if (typeof asked !== "number") return null;
  const t = bodyText.slice(0, 4000);
  if (!/max_tokens|max_completion_tokens|maximum.{0,40}tokens|output tokens/i.test(t)) return null;
  const candidates = [...t.matchAll(/\b(\d{3,7})\b/g)].map((m) => Number(m[1])).filter((n) => n >= 256 && n < asked);
  return candidates.length ? Math.max(...candidates) : null;
}

function learnMaxTokens(p: Pick<WireProvider, "host" | "model">, cap: number): void {
  const k = shapeKey(p);
  refused.set(k, { ...(refused.get(k) ?? {}), maxTokensCap: cap });
  console.warn(`[llm-wire] ${p.host} ${p.model} caps max_tokens at ${cap}; asking for at most that from now on`);
}

/** Test seam: forget everything learned at runtime. */
export function resetWireMemory(): void {
  refused.clear();
  gates.clear();
}

// ─────────────────────────── 2 + 3. CONCURRENCY + PRIORITY ───────────────────────────

interface Waiter {
  rank: number;
  seq: number;
  go: () => void;
}
interface Gate {
  active: number;
  /** a cap the provider stated in a 429, which wins over the configured limit. */
  learnedCap: number | null;
  waiters: Waiter[];
}
const gates = new Map<string, Gate>();
let seq = 0;

/** A key's identity for queueing, never the key itself. */
function gateKey(p: Pick<WireProvider, "host" | "key">): string {
  return `${p.host}|${createHash("sha256").update(p.key).digest("hex").slice(0, 12)}`;
}

/** Requests one provider key may have in flight. `LLM_MAX_CONCURRENCY=1` restores the old single lane. */
export function configuredConcurrency(): number {
  const raw = Number(process.env.LLM_MAX_CONCURRENCY);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 4;
}

function limitOf(g: Gate): number {
  return Math.max(1, Math.min(configuredConcurrency(), g.learnedCap ?? Number.POSITIVE_INFINITY));
}

function gateFor(p: Pick<WireProvider, "host" | "key">): Gate {
  const k = gateKey(p);
  let g = gates.get(k);
  if (!g) {
    g = { active: 0, learnedCap: null, waiters: [] };
    gates.set(k, g);
  }
  return g;
}

function release(g: Gate): void {
  g.active = Math.max(0, g.active - 1);
  while (g.active < limitOf(g) && g.waiters.length > 0) {
    g.waiters.sort((a, b) => a.rank - b.rank || a.seq - b.seq);
    const next = g.waiters.shift()!;
    g.active++;
    next.go();
  }
}

/** Run `fn` holding one of this key's slots. A failure releases the slot like a success does. */
export async function withSlot<T>(p: Pick<WireProvider, "host" | "key">, priority: WirePriority, fn: () => Promise<T>): Promise<T> {
  const g = gateFor(p);
  if (g.active < limitOf(g) && g.waiters.length === 0) {
    g.active++;
  } else {
    await new Promise<void>((go) => g.waiters.push({ rank: RANK[priority], seq: seq++, go }));
  }
  try {
    return await fn();
  } finally {
    release(g);
  }
}

/** "…quota exceeded (cap 1)" → 1. The provider's own statement of its concurrency limit. */
export function statedCap(bodyText: string): number | null {
  const m = /\bcap\s*[:=]?\s*(\d{1,3})\b/i.exec(bodyText.slice(0, 2000));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : null;
}

// ───────────────────────────── THE SEND ─────────────────────────────

export interface WireResponse {
  ok: boolean;
  status: number;
  /** the full body, already read inside the timeout and the slot. */
  text: string;
  retryAfterMs: number | null;
  /** the body that was actually sent, after shaping (never logged; for tests and telemetry shape only). */
  sent: Record<string, unknown>;
}

/**
 * The body as text. A real Response has text(); the suites stub fetch with Response-LIKE objects that
 * carry only json(), and the wire must read both the same way rather than force every stub to change.
 */
async function readBody(res: Response): Promise<string> {
  const r = res as Partial<Response>;
  if (typeof r.text === "function") return await r.text();
  if (typeof r.json === "function") return JSON.stringify(await r.json());
  return "";
}

function headerOf(res: Response, name: string): string | null {
  const h = (res as Partial<Response>).headers;
  return h && typeof h.get === "function" ? h.get(name) : null;
}

function parseRetryAfterMs(h: string | null): number | null {
  if (!h) return null;
  const secs = Number(h.trim());
  return Number.isFinite(secs) ? Math.round(secs * 1000) : null;
}

/**
 * POST one chat completion. The timeout starts when the request does, not when it joins the queue. A
 * call that waited behind two long generations used to have its whole budget spent before it reached
 * the provider. The body is read inside the timeout, so a stalled stream can't hang a founder either.
 * Throws only on a network failure or an abort; every HTTP status comes back as a WireResponse for the
 * caller to classify.
 */
export async function postChat(
  p: WireProvider,
  body: Record<string, unknown>,
  opts: {
    timeoutMs: number;
    priority?: WirePriority;
    profile?: ProviderProfile;
    signal?: AbortSignal;
    headers?: Record<string, string>;
    /** fault-injection seam for the suites (the payout judge's own tests drive refusals through it). */
    fetchImpl?: typeof fetch;
  },
): Promise<WireResponse> {
  const profile = opts.profile ?? profileFor(p.model, p.endpoint);
  return withSlot(p, opts.priority ?? "background", async () => {
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onOuterAbort, { once: true });
    if (opts.signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      // At most one re-send per refused parameter: a provider that keeps refusing something we
      // already removed is a real error, and it surfaces as one.
      for (let heal = 0; ; heal++) {
        const sent = shapeRequest(p, profile, body);
        const res = await (opts.fetchImpl ?? fetch)(p.endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json", ...(opts.headers ?? {}) },
          signal: controller.signal,
          body: JSON.stringify(sent),
        });
        const text = await readBody(res);
        if (!res.ok && heal < 4) {
          const what = refusedParameter(res.status, text, sent);
          if (what) {
            learnRefusal(p, what);
            continue;
          }
          const cap = statedMaxTokens(res.status, text, sent);
          if (cap !== null) {
            learnMaxTokens(p, cap);
            continue;
          }
          if (res.status === 429) {
            const cap = statedCap(text);
            if (cap !== null) {
              const g = gateFor(p);
              if (g.learnedCap === null || cap < g.learnedCap) g.learnedCap = cap;
            }
          }
        }
        return { ok: res.ok, status: res.status, text, retryAfterMs: parseRetryAfterMs(headerOf(res, "retry-after")), sent };
      }
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onOuterAbort);
    }
  });
}

/** The priority a lane's caller is waiting with. Unlabelled calls are background design. */
export function priorityForLane(lane: string | undefined): WirePriority {
  if (lane === "DRAFT" || lane === "CONCIERGE") return "interactive";
  if (lane === "PAYOUT" || lane === "OBS_JUDGE" || lane === "VISION") return "judgment";
  return "background";
}
