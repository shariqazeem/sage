import { vi } from "vitest";

/**
 * THE MODEL ZOO: a fake provider at the fetch level, one behaviour per host.
 *
 * Every behaviour here was measured on a real provider (the dates are in the code each one exercises:
 * wire.ts, complete.ts, provider-profile.ts, mission-brain.ts). The zoo answers the OpenAI-compatible
 * chat/completions call the wire sends, with the latency the real thing had, on vitest's fake clock, so a
 * lane's whole ladder (retries, waits, hedges, fallbacks, the design deadline) runs in milliseconds of real
 * time and its WALL CLOCK is read off the fake clock exactly.
 *
 * No network, no keys, no model. What an answer SAYS comes from the test (`answer`), so each lane is given a
 * correct answer for its own prompt and the behaviour decides only how that answer is delivered or withheld.
 *
 * Product fixtures can be added beside the one in `fixtures.ts`: a battery row is (lane, behaviour, fixture).
 */
export const BEHAVIOURS = [
  "healthy",
  /** finish "length", empty content, the whole budget spent (MiniMax M3 on the architect prompt, 21 Nov 2026) */
  "think_only_empty",
  /** finish "length", content is one unclosed <think> block */
  "think_only_unclosed",
  /** a closed <think> block that drafts its own ```json fence, then the real answer (play2048, 27 Aug 2026) */
  "decoy_fence",
  /** the reasoning arrives in a separate field beside a normal answer */
  "reasoning_field",
  /** the whole answer inside one ```json fence (prod, 15 Aug 2026) */
  "fenced",
  /** a sentence before the JSON and a sentence after it (prod, 16 Aug 2026) */
  "trailing_prose",
  /** the JSON is cut mid-answer, finish "length" */
  "cut_mid_answer",
  /** 400 while `temperature` is sent (Anthropic's endpoint, 5 Nov 2026) */
  "refuses_temperature",
  /** 400 while response_format is json_object (Anthropic's endpoint, 5 Nov 2026) */
  "refuses_json_object",
  /** HTTP 500 to every call, after about 24 s (DeepSeek V4 Flash on CommonStack, 21 Nov 2026) */
  "always_500",
  /** two plain 429s, then healthy */
  "burst_429",
  /** 429 "Access key quota exceeded (cap 3)" to every call (the key's spending quota, 21 Nov 2026) */
  "capped_429",
  /** 429 "Insufficient available balance" (an empty account, 5 Nov 2026) */
  "empty_account",
  /** answers correctly, after fifteen minutes */
  "very_slow",
  /** takes an image, returns 200, and reports seeing no image (MiniMax) */
  "blind",
  /** a correct answer under invented field names, with invented money fields beside it */
  "invents_fields",
] as const;
export type Behaviour = (typeof BEHAVIOURS)[number];

export interface ZooCall {
  host: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  hasImage: boolean;
  /** fake-clock ms when the call arrived */
  at: number;
  body: Record<string, unknown>;
}

/** Tokens a second the zoo's models write at: MiniMax M3 measured 6,583 tokens in 116 s (2 Sep 2026). */
export const TOKENS_PER_SEC = 57;
const HEALTHY_MS = 2_000;
const ERROR_500_MS = 24_000;
const VERY_SLOW_MS = 15 * 60_000;

function abortError(): Error {
  return Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
}

/** A wait on the (fake) clock that ends with an AbortError the moment the caller gives up, as fetch does. */
function wait(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(abortError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** A correct answer, renamed and decorated the way a model that ignores the schema does it. */
export function inventFields(answer: unknown): unknown {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return answer;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(answer as Record<string, unknown>)) {
    out[`${k}_v2`] = Array.isArray(v) ? v.map((x) => (x && typeof x === "object" ? { ...(x as object), rewardUsd: 500, payout: "500 USDC" } : x)) : v;
  }
  // money a model has no business stating, at the top level too
  return { ...out, rewardUsd: 500, amount: "500", totalBudget: "5000 USDC" };
}

export class Zoo {
  readonly calls: ZooCall[] = [];
  private readonly behaviour = new Map<string, Behaviour>();
  private readonly seen = new Map<string, number>();

  /** `answer` is what a correct model would say to this call (an object, serialised by the zoo). */
  constructor(private readonly answer: (call: ZooCall) => unknown) {}

  set(host: string, b: Behaviour): this {
    this.behaviour.set(host, b);
    return this;
  }

  callsTo(host: string): number {
    return this.calls.filter((c) => c.host === host).length;
  }

  install(): void {
    vi.stubGlobal("fetch", this.fetch);
  }

  readonly fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const host = new URL(String(url)).host;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const messages = (body.messages ?? []) as { role: string; content: unknown }[];
    const text = (c: unknown) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p as { text?: string }).text ?? "").join("") : "");
    const call: ZooCall = {
      host,
      model: String(body.model ?? ""),
      system: text(messages.find((m) => m.role === "system")?.content),
      user: text(messages.find((m) => m.role === "user")?.content),
      maxTokens: Number(body.max_tokens ?? 0),
      hasImage: messages.some((m) => Array.isArray(m.content) && m.content.some((p) => (p as { type?: string }).type === "image_url")),
      at: Date.now(),
      body,
    };
    this.calls.push(call);
    const n = (this.seen.get(host) ?? 0) + 1;
    this.seen.set(host, n);
    const signal = init?.signal;
    const b = this.behaviour.get(host) ?? "healthy";
    const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
    const completion = (content: string, finish: string, extra: Record<string, unknown> = {}, tokens = Math.ceil(content.length / 4)) =>
      json(200, { model: call.model, choices: [{ message: { role: "assistant", content, ...extra }, finish_reason: finish }], usage: { prompt_tokens: 1_000, completion_tokens: tokens } });
    const right = () => JSON.stringify(this.answer(call));
    const healthy = async () => {
      await wait(HEALTHY_MS, signal);
      return completion(right(), "stop");
    };
    const wholeBudgetMs = Math.ceil((call.maxTokens / TOKENS_PER_SEC) * 1000);

    switch (b) {
      case "healthy":
        return healthy();
      case "think_only_empty":
        await wait(wholeBudgetMs, signal);
        return completion("", "length", { reasoning_content: "Let me think about every page in turn…" }, call.maxTokens);
      case "think_only_unclosed":
        await wait(wholeBudgetMs, signal);
        return completion(`<think>\nLet me think about every page in turn. ${"Considering the next state. ".repeat(40)}`, "length", {}, call.maxTokens);
      case "decoy_fence":
        await wait(HEALTHY_MS * 3, signal);
        return completion(`<think>\nA first draft could be:\n\`\`\`json\n{"draft":true,"missions":"not yet"}\n\`\`\`\nNo, the real one follows.\n</think>\n\n${right()}`, "stop");
      case "reasoning_field":
        await wait(HEALTHY_MS * 3, signal);
        return completion(right(), "stop", { reasoning_content: 'I considered {"draft":true} and decided against it.' });
      case "fenced":
        await wait(HEALTHY_MS, signal);
        return completion(`\`\`\`json\n${right()}\n\`\`\``, "stop");
      case "trailing_prose":
        await wait(HEALTHY_MS, signal);
        return completion(`Here is what I found:\n\n${right()}\n\nLet me know if you would like changes.`, "stop");
      case "cut_mid_answer": {
        await wait(Math.min(wholeBudgetMs, 60_000), signal);
        const whole = right();
        return completion(whole.slice(0, Math.floor(whole.length * 0.6)), "length", {}, call.maxTokens);
      }
      case "refuses_temperature":
        if ("temperature" in body) return json(400, { error: { message: "`temperature` is deprecated for this model." } });
        return healthy();
      case "refuses_json_object":
        if ((body.response_format as { type?: string } | undefined)?.type === "json_object") return json(400, { error: { message: "response_format.type: Input should be 'json_schema'" } });
        return healthy();
      case "always_500":
        await wait(ERROR_500_MS, signal);
        return json(500, { error: { message: "Internal server error" } });
      case "burst_429":
        if (n <= 2) return json(429, { error: { message: "Too many requests" } });
        return healthy();
      case "capped_429":
        return json(429, { error: { message: "Access key quota exceeded (cap 3)" } });
      case "empty_account":
        return json(429, { error: { message: "Insufficient available balance: 0" } });
      case "very_slow":
        await wait(VERY_SLOW_MS, signal);
        return completion(right(), "stop");
      case "blind":
        await wait(HEALTHY_MS, signal);
        return completion(call.hasImage ? JSON.stringify({ sceneDescription: "I don't see any image attached to this message.", uiElements: [] }) : right(), "stop");
      case "invents_fields":
        await wait(HEALTHY_MS, signal);
        return completion(JSON.stringify(inventFields(this.answer(call))), "stop");
    }
  };
}

/**
 * Run `fn` on the fake clock until it settles, and say how long it took THERE. One second a step, so a
 * 25-minute stall would be 1,500 steps and is caught by `ceilingMs` long before a real timeout.
 */
export async function onFakeClock<T>(fn: () => Promise<T>, ceilingMs = 45 * 60_000): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  let settled = false;
  let value: T | undefined;
  let error: unknown;
  let failed = false;
  void fn().then(
    (v) => {
      value = v;
      settled = true;
    },
    (e) => {
      error = e;
      failed = true;
      settled = true;
    },
  );
  while (!settled) {
    if (Date.now() - started > ceilingMs) throw new Error(`still running after ${Math.round(ceilingMs / 1000)} s on the fake clock: a stall`);
    await vi.advanceTimersByTimeAsync(1_000);
  }
  if (failed) throw error;
  return { value: value as T, ms: Date.now() - started };
}
