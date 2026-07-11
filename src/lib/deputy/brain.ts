import "server-only";

import { assessSubmission } from "@/lib/campaigns/assess";
import {
  SYSTEM_PROMPT,
  buildUserContent,
  repairJson,
  parseBriefContent,
  enforceQuotes,
  hardenBrief,
  heuristicBrief,
  estimateCostUsd,
  type BrainInput,
  type DecisionBrief,
} from "./brain-core";

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
interface LlmProvider {
  endpoint: string;
  key: string;
  model: string;
  /** the provider host, recorded on the brief's `provider` (e.g. "api.commonstack.ai"). */
  host: string;
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

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * ONE call to a provider — fetch, parse, enforce quotes, then build + harden the
 * brief. Throws on any failure (bad status, empty or unparseable output, timeout)
 * so the caller can retry or fail over. A success is always engine "llm", stamped
 * with the model + provider host that produced it. `started` anchors latency to
 * the whole decision (including any prior failed attempts), which is the honest
 * wall-clock a reviewer cares about.
 */
async function callProvider(
  p: LlmProvider,
  input: BrainInput,
  started: number,
): Promise<DecisionBrief> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(p.endpoint, {
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
        // Force valid JSON — without this some models drop the outer braces.
        // A provider that ignores it just falls to the repair + fail-over path.
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserContent(input) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`llm ${res.status}`);

    const data = (await res.json()) as ChatResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("empty completion");

    const parsed = parseBriefContent(repairJson(content));
    if (!parsed) throw new Error("unparseable brief");

    const { content: safe } = enforceQuotes(parsed, input.evidenceText);
    return hardenBrief(
      {
        ...safe,
        engine: "llm",
        model: p.model,
        provider: p.host,
        evidenceOk: input.evidenceOk,
        contentSha256: input.contentSha256 ?? null,
        latencyMs: Date.now() - started,
        costUsd: estimateCostUsd(
          p.model,
          data.usage?.prompt_tokens ?? 0,
          data.usage?.completion_tokens ?? 0,
        ),
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
export async function verifySubmission(input: BrainInput): Promise<DecisionBrief> {
  const primary = primaryProvider();
  if (!primary) return hardenBrief(heuristicFallback(input, null), input);

  const started = Date.now();

  // 1) PRIMARY — retry transient provider failures (CommonStack intermittently
  //    hangs) before failing over; a fresh connection usually succeeds, which
  //    keeps autopilot on the verified LLM path instead of the heuristic.
  for (let attempt = 1; attempt <= LLM_ATTEMPTS; attempt++) {
    try {
      return await callProvider(primary, input, started);
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
  const fallback = fallbackProvider();
  if (fallback) {
    try {
      const brief = await callProvider(fallback, input, started);
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
