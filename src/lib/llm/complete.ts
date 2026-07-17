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
  model: string;
  provider: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
}

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
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
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
}): Promise<LlmComplete> {
  const p = resolveLlm(opts.model);
  if (!p) throw new Error("llm_not_configured");
  const started = Date.now();
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
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`llm_status_${res.status}`);
    const data = (await res.json()) as ChatResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("llm_empty");
    let json: unknown;
    const extracted = extractJson(content);
    try {
      json = JSON.parse(extracted);
    } catch {
      // recovery rung: bounded structural repair before giving up.
      json = repairJson(extracted);
      if (json === null) throw new Error("llm_unparseable");
    }
    return {
      json,
      model: p.model,
      provider: p.host,
      latencyMs: Date.now() - started,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}
