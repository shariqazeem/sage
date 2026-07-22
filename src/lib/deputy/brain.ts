import "server-only";

import { assessSubmission } from "@/lib/campaigns/assess";
import {
  SYSTEM_PROMPT,
  PAYOUT_PROMPT_VERSION,
  buildUserContent,
  parseBriefContent,
  enforceQuotes,
  hardenBrief,
  heuristicBrief,
  estimateCostUsd,
  type BrainInput,
  type DecisionBrief,
  type DecisionBriefContent,
} from "./brain-core";
import { readCompletion, terminationRejectReason, type ChatCompletionResponse } from "./completion";

/**
 * POLICY-IDENTITY version of the MONEY-PATH PARSE in {@link callProvider} — how raw model output is
 * turned into a brief that can authorize a payout. The autopay identity gate (`model-policy.ts`) pins the
 * EXACT parser version that passed the promotion battery, so any change to how the money decision is
 * parsed (e.g. tightening it to reject repaired / truncated / partial output) MUST bump this and be
 * re-evaluated before autopay is re-approved. Non-money generation paths are unaffected by this constant.
 *
 * v2 — the STRICT money parse: JSON.parse only, no repairJson/fence-strip/brace-wrap/balanced-extraction/
 * partial completion.
 * v3 — additionally requires EXPLICIT normal completion termination (the completion adapter): a payout may
 * be authorized only when the provider signalled a recognized normal finish (`stop`); an absent/unknown
 * finish_reason, a truncation (length/max_tokens), a content filter, or a refusal fails closed. Strictly a
 * SUBSET of what v2 accepted, so it can only reduce autopay recall, never increase autopay.
 */
export const PARSER_POLICY_VERSION = "payout-parse-v3";

/**
 * ============================================================================
 * JUDGMENT LAYER FROZEN for Demo Day — 2026-07-09. The provider chain + the
 * verification call are part of the frozen judgment layer; do not change without
 * re-running the full re-verification protocol (docs/AGENT.md §8). See brain-core.ts.
 * ============================================================================
 *
 * The Deputy brain (server-only). `verifySubmission` judges a submission's
 * eligibility over an OpenAI-compatible Chat Completions API, with strict-JSON
 * output, verbatim-quote enforcement, and a rule the model can't touch: it never
 * computes a payout.
 *
 * The provider chain — PRIMARY (retried) → FALLBACK (a different provider, once)
 * → the transparent HEURISTIC — is demo-day insurance: a primary outage still
 * yields a verified LLM brief instead of silently degrading. The heuristic
 * remains the ONLY engine that can never auto-pay, so an outage can only make the
 * Deputy cautious, never wrong with money.
 *
 * THE LLM PROPOSES, THE VAULT DISPOSES: this brief is advisory. It feeds the
 * existing settle path; it gains no new powers.
 */

const DEFAULT_BASE_URL = "https://api.commonstack.ai/v1";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
const LLM_TIMEOUT_MS = 35_000;
// Headroom for the structured summary + reasonCode so a concise model never
// truncates its JSON (a truncation would fail the parse and force a fail-over).
const MAX_TOKENS = 1200;
const LLM_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A resolved LLM endpoint the brain can call. */
export interface LlmProvider {
  endpoint: string;
  key: string;
  model: string;
  /** the provider host, recorded on the brief's `provider` (e.g. "api.commonstack.ai"). */
  host: string;
}

/**
 * Evaluation-only injection for {@link verifySubmission}. When omitted (production), the brain resolves
 * its provider chain from the environment exactly as before — every field here is opt-in and defaults to
 * the current behavior, so a plain `verifySubmission(input)` call is byte-identical to pre-seam code.
 * This lets P-JUDGE drive the REAL production judgment path (prompt → parse → enforceQuotes → hardenBrief
 * → the provenance-stamped brief) against a CHOSEN model, and lets the fault-injection tests simulate a
 * timeout / refusal / truncation / fallback deterministically — with NO copied logic to drift.
 */
export interface VerifyOptions {
  /** Force the PRIMARY provider (skip env resolution). `null` = no primary (test the no-LLM path). */
  provider?: LlmProvider | null;
  /** Force the FALLBACK provider. `null` = no fallback. */
  fallback?: LlmProvider | null;
  /** Inject fetch (fault-injection tests). Production uses the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Build a PRIMARY provider that judges with a specific `model` on the configured base + key — the seam
 * P-JUDGE uses to bake off a candidate model through the exact production call. Returns null when no
 * primary key is configured. Omit `model` to get the env-resolved primary unchanged.
 */
export function providerForModel(model?: string): LlmProvider | null {
  const p = primaryProvider();
  if (!p) return null;
  return model?.trim() ? { ...p, model: model.trim() } : p;
}

/** Host of a URL for the brief's `provider` field; falls back to the raw string. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** First non-empty trimmed candidate, else the default base; trailing slashes stripped. */
function baseFrom(...candidates: (string | undefined)[]): string {
  const base = candidates.map((c) => c?.trim()).find(Boolean) ?? DEFAULT_BASE_URL;
  return base.replace(/\/+$/, "");
}

/**
 * The Deputy's LLM is provider-agnostic: any OpenAI-compatible chat-completions
 * endpoint works (OpenRouter, OpenAI, CommonStack, a local gateway). Configure
 * the PRIMARY with LLM_BASE_URL / LLM_API_KEY / LLM_MODEL; the legacy COMMONSTACK_*
 * vars are the fallback so existing setups keep working. null when no key is set
 * (→ the app runs on the honest heuristic).
 */
function primaryProvider(): LlmProvider | null {
  const key = process.env.LLM_API_KEY?.trim() || process.env.COMMONSTACK_API_KEY?.trim();
  if (!key) return null;
  const base = baseFrom(process.env.LLM_BASE_URL, process.env.COMMONSTACK_BASE_URL);
  return { endpoint: `${base}/chat/completions`, key, model: deputyModel(), host: hostOf(base) };
}

/**
 * The FALLBACK provider — a DIFFERENT OpenAI-compatible provider the brain fails
 * over to when the primary is exhausted. null unless all three LLM_FALLBACK_* vars
 * are set, so it is opt-in and never accidentally engaged.
 */
function fallbackProvider(): LlmProvider | null {
  const key = process.env.LLM_FALLBACK_API_KEY?.trim();
  const rawBase = process.env.LLM_FALLBACK_BASE_URL?.trim();
  const model = process.env.LLM_FALLBACK_MODEL?.trim();
  if (!key || !rawBase || !model) return null;
  const base = rawBase.replace(/\/+$/, "");
  return { endpoint: `${base}/chat/completions`, key, model, host: hostOf(base) };
}

/** The configured primary model (env override), or the cheap default. */
export function deputyModel(): string {
  return (
    process.env.LLM_MODEL?.trim() || process.env.DEPUTY_MODEL?.trim() || DEFAULT_MODEL
  );
}

/** Whether a PRIMARY LLM key is configured — drives the honest "LLM pending" label. */
export function hasLlm(): boolean {
  return !!(process.env.LLM_API_KEY?.trim() || process.env.COMMONSTACK_API_KEY?.trim());
}

function heuristicFallback(input: BrainInput, latencyMs: number | null): DecisionBrief {
  const a = assessSubmission({
    criteria: input.criteria,
    rewardAmount: 0, // the heuristic's payoutBase is unused by the brief
    evidenceUrl: input.evidenceUrl,
    note: input.note,
  });
  return heuristicBrief(a, {
    evidenceOk: input.evidenceOk,
    contentSha256: input.contentSha256 ?? null,
    latencyMs,
  });
}

/**
 * STRICT money-decision parse — the payout path must NEVER repair, salvage, or complete a model's output.
 * Unlike the tolerant `repairJson` (kept for non-money generation), this does exactly one thing: JSON.parse
 * the raw content. No fence-stripping, no brace re-wrapping, no first-balanced-object extraction, no
 * partial completion. Trailing content, fences, prose wrapping, or a truncated body all throw → the caller
 * fails over → the heuristic (which can never autopay). It then requires the money-critical fields
 * (recommendation + a numeric confidence) to be EXPLICITLY present; a partial decision fails closed. The
 * remaining fields are shaped by the shared coercer over the already-strictly-parsed object (never the
 * transport). Returns null on any deviation — this can only REDUCE what autopays, never increase it.
 */
function parseMoneyBrief(content: string): DecisionBriefContent | null {
  let obj: unknown;
  try {
    obj = JSON.parse(content.trim());
  } catch {
    return null; // not strict JSON — no repair is attempted on the money path
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  // Money-critical fields must be EXPLICITLY present + well-formed — a missing/partial decision fails closed.
  if (o.recommendation !== "pay" && o.recommendation !== "review" && o.recommendation !== "hold") return null;
  if (o.confidence == null || !Number.isFinite(Number(o.confidence))) return null;
  return parseBriefContent(o);
}

/**
 * ONE call to a provider — fetch, STRICT-parse, enforce quotes, then build + harden the brief. Throws on
 * any failure (bad status, an abnormal finish_reason, a refusal, an empty / non-strict-JSON / incomplete
 * output, timeout) so the caller can retry or fail over. The money parse never repairs: a fenced, prose-
 * wrapped, brace-dropped, trailing-garbage, or truncated body is REJECTED here rather than salvaged. A
 * success is always engine "llm", stamped with the model + provider host that produced it. `started`
 * anchors latency to the whole decision (including any prior failed attempts), the honest wall-clock.
 */
async function callProvider(
  p: LlmProvider,
  input: BrainInput,
  started: number,
  fetchImpl: typeof fetch = fetch,
): Promise<DecisionBrief> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetchImpl(p.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${p.key}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: p.model,
        temperature: 0,
        max_tokens: MAX_TOKENS,
        // Force valid JSON — without this some models drop the outer braces. A provider that ignores it
        // fails the STRICT money parse (parseMoneyBrief) and falls over; it is never repaired or salvaged.
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserContent(input) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`llm ${res.status}`);

    const data = (await res.json()) as ChatCompletionResponse;
    const completion = readCompletion(data); // preserve the provider's actual termination metadata
    // FAIL CLOSED unless the provider EXPLICITLY signalled a normal completion. A refusal, an ABSENT
    // finish_reason, a truncation (length/max_tokens), a content filter, or any non-normal reason all mean
    // this is not a payable decision — even if the body parses. The money path never infers a normal
    // completion from a parseable object; a syntactically complete PAY object with finish_reason "length"
    // must not pay.
    const reject = terminationRejectReason(completion);
    if (reject) throw new Error(`non-normal completion: ${reject}`);
    if (!completion.content) throw new Error("empty completion");

    const parsed = parseMoneyBrief(completion.content); // STRICT — no repair/salvage on the payout path
    if (!parsed) throw new Error("unparseable or incomplete money brief");

    const { content: safe } = enforceQuotes(parsed, input.evidenceText);
    return hardenBrief(
      {
        ...safe,
        engine: "llm",
        model: p.model,
        provider: p.host,
        // POLICY IDENTITY — the exact prompt + money-parser that produced this brief. hardenBrief spreads
        // the brief, so these survive into the returned + persisted brief for the autopay identity gate.
        promptVersion: PAYOUT_PROMPT_VERSION,
        parserVersion: PARSER_POLICY_VERSION,
        evidenceOk: input.evidenceOk,
        contentSha256: input.contentSha256 ?? null,
        latencyMs: Date.now() - started,
        costUsd: estimateCostUsd(p.model, completion.promptTokens, completion.completionTokens),
        x402PaymentTx: null,
      },
      input,
    );
  } finally {
    clearTimeout(timer);
  }
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Judge one submission. Always resolves with a DecisionBrief — never throws.
 *
 * Chain: PRIMARY (up to LLM_ATTEMPTS, retrying transient failures / malformed
 * JSON) → FALLBACK provider ONCE (a different provider, if configured) → the
 * honest HEURISTIC. A fallback success is still engine "llm" (it can auto-pay);
 * only the heuristic can never auto-pay.
 */
export async function verifySubmission(input: BrainInput, opts: VerifyOptions = {}): Promise<DecisionBrief> {
  // Production: undefined → env resolution (byte-identical to before). Eval: an explicit provider (or an
  // explicit `null` to test the no-LLM degrade). `fetchImpl` defaults to the global fetch.
  const primary = opts.provider !== undefined ? opts.provider : primaryProvider();
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (!primary) return hardenBrief(heuristicFallback(input, null), input);

  const started = Date.now();

  // 1) PRIMARY — retry transient provider failures (CommonStack intermittently
  //    hangs) before failing over; a fresh connection usually succeeds, which
  //    keeps autopilot on the verified LLM path instead of the heuristic.
  for (let attempt = 1; attempt <= LLM_ATTEMPTS; attempt++) {
    try {
      return await callProvider(primary, input, started, fetchImpl);
    } catch (err) {
      console.error(
        `[deputy/brain] primary ${primary.host} attempt ${attempt}/${LLM_ATTEMPTS} failed:`,
        errMsg(err),
      );
      if (attempt < LLM_ATTEMPTS) await sleep(600 * attempt);
    }
  }

  // 2) FALLBACK — one shot on a DIFFERENT provider. Demo-day insurance: a primary
  //    outage still yields a verified LLM brief instead of silently degrading to
  //    the heuristic (which can never auto-pay), so the hero moment survives.
  const fallback = opts.fallback !== undefined ? opts.fallback : fallbackProvider();
  if (fallback) {
    try {
      const brief = await callProvider(fallback, input, started, fetchImpl);
      console.warn(
        `[deputy/brain] primary exhausted — failed over to ${fallback.host} (${fallback.model})`,
      );
      return brief;
    } catch (err) {
      console.error(`[deputy/brain] fallback ${fallback.host} failed:`, errMsg(err));
    }
  }

  // 3) HEURISTIC — honest degrade, labeled engine "heuristic"; never auto-pays.
  return hardenBrief(heuristicFallback(input, Date.now() - started), input);
}
