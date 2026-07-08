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
 * The Deputy brain (server-only). `verifySubmission` calls CommonStack's
 * OpenAI-compatible Chat Completions API to judge a submission's eligibility,
 * with strict-JSON output, verbatim-quote enforcement, and a hard rule the
 * model can't touch: it never computes a payout. On a missing key OR any
 * failure it falls back to the transparent heuristic, labeled engine
 * "heuristic" — so the app is fully functional and honest without a key.
 *
 * THE LLM PROPOSES, THE VAULT DISPOSES: this brief is advisory. It feeds the
 * existing settle path; it gains no new powers.
 */

const DEFAULT_BASE_URL = "https://api.commonstack.ai/v1";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
const LLM_TIMEOUT_MS = 35_000;
const MAX_TOKENS = 900;
const LLM_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The Deputy's LLM is provider-agnostic: any OpenAI-compatible chat-completions
 * endpoint works (OpenRouter, OpenAI, CommonStack, a local gateway). Configure
 * with LLM_BASE_URL / LLM_API_KEY / LLM_MODEL; the legacy COMMONSTACK_* vars are
 * the fallback so existing setups keep working. This is what lets the agent run
 * on a provider the host can actually reach — a hardcoded endpoint that a given
 * network can't reach silently degrades every verification to the heuristic.
 */
function llmBaseUrl(): string {
  const base =
    process.env.LLM_BASE_URL?.trim() ||
    process.env.COMMONSTACK_BASE_URL?.trim() ||
    DEFAULT_BASE_URL;
  return base.replace(/\/+$/, "");
}
function llmEndpoint(): string {
  return `${llmBaseUrl()}/chat/completions`;
}
function llmKey(): string | undefined {
  return process.env.LLM_API_KEY?.trim() || process.env.COMMONSTACK_API_KEY?.trim();
}

/** The configured model (env override), or the cheap default. */
export function deputyModel(): string {
  return (
    process.env.LLM_MODEL?.trim() || process.env.DEPUTY_MODEL?.trim() || DEFAULT_MODEL
  );
}

/** Whether an LLM key is configured — drives the honest "LLM pending" label. */
export function hasLlm(): boolean {
  return !!llmKey();
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
 * Judge one submission. Always resolves with a DecisionBrief — never throws.
 */
export async function verifySubmission(input: BrainInput): Promise<DecisionBrief> {
  const key = llmKey();
  if (!key) return hardenBrief(heuristicFallback(input, null), input);

  const model = deputyModel();
  const started = Date.now();

  // Retry transient provider failures (CommonStack occasionally hangs) before
  // degrading. A fresh connection usually succeeds — this keeps autopilot on the
  // verified LLM path instead of silently falling to the heuristic (which never
  // auto-pays), so a momentary blip doesn't hold a legitimate payout.
  for (let attempt = 1; attempt <= LLM_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    try {
      const res = await fetch(llmEndpoint(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: MAX_TOKENS,
          // Force valid JSON — without this some models drop the outer braces.
          // A provider that ignores it just falls to the repair + heuristic path.
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
      const latencyMs = Date.now() - started;
      const costUsd = estimateCostUsd(
        model,
        data.usage?.prompt_tokens ?? 0,
        data.usage?.completion_tokens ?? 0,
      );

      return hardenBrief(
        {
          ...safe,
          engine: "llm",
          model,
          evidenceOk: input.evidenceOk,
          contentSha256: input.contentSha256 ?? null,
          latencyMs,
          costUsd,
          x402PaymentTx: null,
        },
        input,
      );
    } catch (err) {
      console.error(
        `[deputy/brain] LLM attempt ${attempt}/${LLM_ATTEMPTS} failed:`,
        err instanceof Error ? err.message : err,
      );
      if (attempt < LLM_ATTEMPTS) await sleep(600 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  // Every attempt failed — the honest heuristic (never eligible for auto-pay).
  return hardenBrief(heuristicFallback(input, Date.now() - started), input);
}
