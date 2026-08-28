import { withTransientRetry } from "@/lib/llm/retry";
import { outputBudget, profileFor } from "@/lib/llm/provider-profile";
import { systemPrompt, TG_TOOLS, WEB_TOOLS } from "./concierge";
import { checkNarration } from "./narration-guard";
import { stripReasoningPrefix as stripThink } from "@/lib/llm/reasoning";
import { ROUTE_FIXTURES, CONFIRM_TOOLS, type RouteFixture } from "./route-fixtures";

/**
 * P-ROUTE — the routing battery over the agent's WHOLE tool surface.
 *
 * It imports production's own prompt builder and tool arrays rather than copying them. P-DIRECT
 * once hand-rolled its tool encoding, the schema landed under a key the API ignores, the model got
 * no parameters and invented field names — and several rounds of "defects" turned out to be the
 * harness. A battery must exercise the real thing or it measures a product that does not exist.
 */


/**
 * READ-THEN-ACT is correct behaviour, not a misroute.
 *
 * The first P-ROUTE run scored "stop the storefront grant" and "add my cousin to that grant" as
 * failures because the agent called `sage_my_campaigns` first. It has to: those utterances name a
 * campaign in WORDS, and the acting tool needs an id. Production runs a multi-round loop and does
 * exactly this. Measuring only turn 1 was the instrument punishing the agent for being right.
 *
 * So a lookup is allowed ONE round, with a stub result fed back, and the target tool must appear on
 * the next round. That is faithful to production without loosening what counts as success: reaching
 * a DIFFERENT acting tool, or never reaching one, still fails.
 */
const LOOKUP_TOOLS = new Set(["sage_my_campaigns", "sage_get_campaign", "sage_my_work", "sage_browse_missions", "sage_get_inspection"]);

/** A minimal, realistic result so the second round has an id to act on. Never richer than the real
 *  tool would return — an over-helpful stub would measure a product that does not exist. */
function stubToolResult(name: string): string {
  if (name === "sage_my_campaigns")
    return JSON.stringify({ ok: true, campaigns: [{ publicCampaignId: "grant-storefront-a1b2", title: "Storefront grant", kind: "grant", status: "live", missions: [{ missionKey: "publish-page", title: "Publish the shop page" }] }] });
  if (name === "sage_browse_missions")
    return JSON.stringify({ ok: true, missions: [{ publicCampaignId: "grant-storefront-a1b2", missionKey: "publish-page", title: "Publish the shop page", rewardUsd: 20 }] });
  if (name === "sage_my_work")
    return JSON.stringify({ ok: true, entries: [{ publicCampaignId: "grant-storefront-a1b2", status: "paid", amountUsd: 20 }], balanceUsd: 20 });
  return JSON.stringify({ ok: true });
}

export interface RouteRow {
  id: string;
  expect: string | null;
  called: string | null;
  ok: boolean;
  /** a confirm_* tool fired on a FIRST turn — the irreversible step, unprompted. */
  prematureConfirm: boolean;
  /** the agent read first (to resolve a name to an id) and then reached the target tool. */
  viaLookup: boolean;
  /** the first turn claimed an action without calling anything, and production's OWN self-correct
   *  round then called the right tool — a recovery the founder actually gets. */
  viaSelfCorrect: boolean;
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

type Msg = { role: string; content?: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };

async function askOnce(f: RouteFixture, timeoutMs: number, history: Msg[] = []): Promise<{ call: ToolCall | null; reply: string; finish?: string; outTokens?: number }> {
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
        ...history,
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
    const first = r.call?.function.name ?? null;
    const accepted: (string | null)[] = f.expect === null ? [null] : [f.expect, ...(f.alsoOk ?? [])];
    // The FIRST call is what the premature-confirm invariant is about: an irreversible step before
    // the person has seen anything. A confirm reached after a lookup is a different (fine) thing.
    const prematureConfirm = !!first && (CONFIRM_TOOLS as readonly string[]).includes(first);

    let called = first;
    let viaLookup = false;
    if (f.expect !== null && first && !accepted.includes(first) && LOOKUP_TOOLS.has(first) && r.call) {
      const second = await withTransientRetry(
        () => askOnce(f, timeoutMs, [
          { role: "assistant", content: r.reply || null, tool_calls: [r.call!] },
          { role: "tool", tool_call_id: r.call!.id, content: stubToolResult(first) },
        ]),
        { attempts: 3 },
      );
      const next = second.call?.function.name ?? null;
      if (next && accepted.includes(next)) { called = next; viaLookup = true; }
      else called = next ?? first;
    }
    /**
     * PRODUCTION SELF-CORRECTS; A ONE-SHOT BATTERY DOES NOT.
     *
     * When a turn claims an action but ran no tool, the concierge feeds its own SYSTEM CHECK back
     * and gives the model one more round to earn the claim. Measuring a single call therefore
     * reports failures a founder never experiences — the same way scoring only turn 1 wrongly
     * failed read-then-act. Modelled here with production's exact corrective message.
     *
     * It is NOT a free pass: the guard must independently judge the reply as an unbacked claim, and
     * the retry must reach the RIGHT tool. A turn that honestly asks a question trips nothing.
     */
    let viaSelfCorrect = false;
    if (f.expect !== null && !called && r.reply) {
      const verdict = checkNarration(stripThink(r.reply), new Set<string>());
      if (!verdict.ok) {
        const corrected = await withTransientRetry(
          () => askOnce(f, timeoutMs, [
            { role: "assistant", content: r.reply },
            { role: "user", content: `SYSTEM CHECK: your draft stated ${verdict.unbacked.join(" and ")} but no tool ran this turn to back it. Do not apologise and do not repeat the claim from memory. Call the right tool NOW and answer only from its result.` },
          ]),
          { attempts: 3 },
        );
        const next = corrected.call?.function.name ?? null;
        if (next && accepted.includes(next)) { called = next; viaSelfCorrect = true; }
      }
    }

    return {
      id: f.id,
      expect: f.expect,
      called,
      ok: accepted.includes(called),
      prematureConfirm,
      viaLookup,
      viaSelfCorrect,
      finish: r.finish,
      outTokens: r.outTokens,
      reply: r.reply,
      failed: false,
    };
  } catch (e) {
    return {
      id: f.id, expect: f.expect, called: null, ok: false, prematureConfirm: false, viaLookup: false, viaSelfCorrect: false,
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
  /** reached the target only after a read tool resolved a name to an id — correct, worth seeing. */
  viaLookup: number;
  /** recovered by production's own self-correct round — a recovery founders actually get. */
  viaSelfCorrect: number;
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
    viaLookup: live.filter((r) => r.viaLookup).length,
    viaSelfCorrect: live.filter((r) => r.viaSelfCorrect).length,
    // A run with provider failures measured nothing: 0 rows -> 0 violations reads as a clean pass.
    conclusive: providerFailures === 0 && live.length > 0,
  };
}
