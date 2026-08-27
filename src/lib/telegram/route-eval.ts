import { withTransientRetry } from "@/lib/llm/retry";
import { outputBudget, profileFor } from "@/lib/llm/provider-profile";
import { systemPrompt, TG_TOOLS, WEB_TOOLS } from "./concierge";
import { ROUTE_FIXTURES, CONFIRM_TOOLS, type RouteFixture } from "./route-fixtures";

/**
 * P-ROUTE — the routing battery over the agent's WHOLE tool surface.
 *
 * It imports production's own prompt builder and tool arrays rather than copying them. P-DIRECT
 * once hand-rolled its tool encoding, the schema landed under a key the API ignores, the model got
 * no parameters and invented field names — and several rounds of "defects" turned out to be the
 * harness. A battery must exercise the real thing or it measures a product that does not exist.
 */

export interface RouteRow {
  id: string;
  expect: string | null;
  called: string | null;
  ok: boolean;
  /** a confirm_* tool fired on a FIRST turn — the irreversible step, unprompted. */
  prematureConfirm: boolean;
  finish?: string;
  outTokens?: number;
  reply: string;
  failed: boolean;
  why?: string;
}

const key = () => process.env.CONCIERGE_API_KEY?.trim() || process.env.LLM_API_KEY?.trim() || process.env.COMMONSTACK_API_KEY?.trim();
const base = () => (process.env.CONCIERGE_BASE_URL?.trim() || process.env.LLM_BASE_URL?.trim() || process.env.COMMONSTACK_BASE_URL?.trim() || "https://api.commonstack.ai/v1").replace(/\/+$/, "");
const model = () => process.env.CONCIERGE_MODEL?.trim() || process.env.LLM_MODEL?.trim() || process.env.DEPUTY_MODEL?.trim() || "deepseek/deepseek-v4-flash";

interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }

async function askOnce(f: RouteFixture, timeoutMs: number): Promise<{ call: ToolCall | null; reply: string; finish?: string; outTokens?: number }> {
  const k = key();
  if (!k) throw new Error("no concierge key in env");
  const res = await fetch(`${base()}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model(),
      temperature: 0.3,
      max_tokens: outputBudget(5_000, profileFor(model(), base())), // production's budget rule
      messages: [
        { role: "system", content: systemPrompt("p-route-eval", f.surface === "web" ? "web" : "telegram") },
        { role: "user", content: f.utterance },
      ],
      tools: f.surface === "web" ? WEB_TOOLS : TG_TOOLS,
      tool_choice: "auto",
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`llm_status_${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
  const data = (await res.json()) as {
    choices?: { message?: { tool_calls?: ToolCall[]; content?: string | null }; finish_reason?: string }[];
    usage?: { completion_tokens?: number };
  };
  const ch = data.choices?.[0];
  return {
    call: ch?.message?.tool_calls?.[0] ?? null,
    reply: (ch?.message?.content ?? "").trim(),
    finish: ch?.finish_reason,
    outTokens: data.usage?.completion_tokens,
  };
}

export async function evalRoute(f: RouteFixture, timeoutMs = 120_000): Promise<RouteRow> {
  try {
    const r = await withTransientRetry(() => askOnce(f, timeoutMs), { attempts: 3 });
    const called = r.call?.function.name ?? null;
    const accepted = f.expect === null ? [null] : [f.expect, ...(f.alsoOk ?? [])];
    return {
      id: f.id,
      expect: f.expect,
      called,
      ok: accepted.includes(called as string & null),
      prematureConfirm: !!called && (CONFIRM_TOOLS as readonly string[]).includes(called),
      finish: r.finish,
      outTokens: r.outTokens,
      reply: r.reply,
      failed: false,
    };
  } catch (e) {
    return {
      id: f.id, expect: f.expect, called: null, ok: false, prematureConfirm: false,
      reply: "", failed: true, why: e instanceof Error ? e.message.slice(0, 180) : String(e).slice(0, 180),
    };
  }
}

export interface RouteMetrics {
  rows: number;
  correct: number;
  misrouted: number;
  /** the invariant: an irreversible confirm_* tool fired unprompted. ANY is a hard failure. */
  prematureConfirms: number;
  /** the model reached for a tool where the honest answer was words. */
  toolOnExplain: number;
  /** the model answered in words where a tool was required. */
  missedTool: number;
  providerFailures: number;
  conclusive: boolean;
}

export function summarize(rows: RouteRow[]): RouteMetrics {
  const live = rows.filter((r) => !r.failed);
  const byId = new Map(ROUTE_FIXTURES.map((f) => [f.id, f]));
  let toolOnExplain = 0, missedTool = 0;
  for (const r of live) {
    const f = byId.get(r.id);
    if (!f || r.ok) continue;
    if (f.expect === null && r.called) toolOnExplain++;
    else if (f.expect !== null && !r.called) missedTool++;
  }
  const providerFailures = rows.filter((r) => r.failed).length;
  return {
    rows: rows.length,
    correct: live.filter((r) => r.ok).length,
    misrouted: live.filter((r) => !r.ok).length,
    prematureConfirms: live.filter((r) => r.prematureConfirm).length,
    toolOnExplain,
    missedTool,
    providerFailures,
    // A run with provider failures measured nothing: 0 rows -> 0 violations reads as a clean pass.
    conclusive: providerFailures === 0 && live.length > 0,
  };
}
