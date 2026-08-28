import "server-only";

import { BASE_PROMPT, DIRECT_BLOCK, DIRECT_CAMPAIGN_TOOL, asOpenAI } from "@/lib/telegram/concierge";
import { conciergeBase, conciergeKey, conciergeModel } from "@/lib/telegram/concierge-config";
import { mapDirectCampaignArgs } from "@/lib/mcp/server";
import { withTransientRetry } from "@/lib/llm/retry";
import { checkNarration } from "@/lib/telegram/narration-guard";
import { stripReasoningPrefix } from "@/lib/llm/reasoning";
import {
  compileDirectCampaign,
  directCampaignSchema,
  lintDirectCampaign,
  type DirectCampaignInput,
} from "./direct-campaign";
import type { DirectFixture } from "./direct-fixtures";

/**
 * P-DIRECT — the money-lane battery, the analogue of P-GEN for gigs and milestone grants.
 *
 * It drives the REAL concierge system prompt and the REAL tool schema against a live model, then
 * pushes whatever the model produced through the REAL transport mapper, the REAL zod schema and
 * the REAL deterministic compiler. Nothing is reimplemented, so a prompt or schema change is
 * measured here rather than discovered by a founder.
 *
 * What it scores is not "did the model answer" but "would this campaign have been safe to fund":
 * correct lane, compiles, exact budget invariant, the founder's own amount, no invented
 * milestones, and a verification contract that is actually checkable.
 */

export interface DirectRow {
  fixtureId: string;
  category: string;
  /** did the model call the direct-campaign tool at all? */
  calledTool: boolean;
  /** routed as the fixture expects (the single most consequential check). */
  routedOk: boolean;
  compiled: boolean;
  /** Σ(reward × slots) === totalBudgetBase, in base units — the frozen budget invariant. */
  budgetExact: boolean | null;
  totalUsd: number | null;
  milestones: number | null;
  /** the founder's stated amount survived into the plan. */
  amountFaithful: boolean | null;
  /** no milestones beyond what the founder described. */
  countFaithful: boolean | null;
  /** every milestone carries a verification contract. */
  allVerifiable: boolean | null;
  /** deterministic proof-strength warnings the operator would be shown. */
  lintNotes: string[];
  error: string | null;
  /** the model's prose when it called no tool — the only way to tell a question from a flail. */
  reply: string;
  /** full length of that reply — the LOGGED text is shortened, the length is not. */
  replyLen: number;
  /** the raw tool arguments when they failed the schema — the shape to design the mapper against. */
  rawArgs: string;
  /** correction rounds used, as production would allow. 0 = right first shot. */
  correctionRounds: number;
  violations: string[];
}

export interface DirectMetrics {
  fixtures: number;
  runs: number;
  rows: number;
  routedWrong: number;
  compileFailures: number;
  budgetViolations: number;
  amountDrift: number;
  inventedMilestones: number;
  unverifiableMissions: number;
  providerFailures: number;
  conclusive: boolean;
  violations: string[];
}

interface ToolCall {
  function?: { name?: string; arguments?: string };
}

/** When the model calls NO tool, its prose is the only evidence of WHY. A clarifying question is a
 *  legitimate outcome ("who is your designer?"); flailing is a defect. Without capturing the reply
 *  the two are indistinguishable and every no-tool row reads the same. */
type Ask = { call: ToolCall | null; reply: string; failed: boolean; why?: string; finish?: string; outTokens?: number };

/** The gateway stalls on roughly a third of calls (documented in concierge.ts). Without the same
 *  bounded retry the battery has, a flaky minute reads as a model-quality result — and a run of
 *  all-failures scores zero violations and "passes" vacuously. Retry, then report honestly. */
async function askModelWithRetry(
  utterance: string,
  timeoutMs: number,
  attempts = 3,
  history: Msg[] = [],
): Promise<Ask> {
  /**
   * PRODUCTION'S OWN LADDER. The hand-rolled 2s/4s version here was far too aggressive for the
   * gateway's real limit — measured 2026-08-28 as `429 quota exceeded (cap 1)`, a CONCURRENCY cap
   * of one — so a 3x battery run failed all 33 calls and, worse, competed with the live concierge
   * for the same key while founders were using it. withTransientRetry knows 429 is transient,
   * honours Retry-After, and spreads attempts over a 90s budget.
   */
  try {
    return await withTransientRetry(
      async () => askModel(utterance, timeoutMs, history),
      { attempts },
    );
  } catch (e) {
    return {
      call: null,
      reply: "",
      failed: true,
      why: e instanceof Error ? e.message.slice(0, 180) : String(e).slice(0, 180),
    };
  }
}

type Msg = { role: string; content?: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };

async function askModel(utterance: string, timeoutMs: number, history: Msg[] = []): Promise<Ask> {
  const key = conciergeKey();
  const base = conciergeBase();
  if (!key) return { call: null, reply: "", failed: true, why: "no concierge api key in env" };
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: conciergeModel(),
        temperature: 0.3,
        // MATCHES PRODUCTION (concierge.ts). A battery on a different budget measures a
        // product that does not exist — 1400 truncated multi-milestone grants mid-JSON.
        max_tokens: 8000,
        messages: [
          { role: "system", content: `${BASE_PROMPT}\n\n${DIRECT_BLOCK}` },
          { role: "user", content: utterance },
          ...history,
        ],
        // Both lanes are offered, because CHOOSING between them is half of what is measured.
        // PRODUCTION'S OWN ENCODER — never a hand-rolled copy (see asOpenAI's comment).
        tools: [
          asOpenAI(DIRECT_CAMPAIGN_TOOL),
          asOpenAI({
            name: "sage_start_inspection",
            description:
              "Start a REAL Sage product-testing inspection for a founder's product URL. Use for 'test my product' / 'get feedback on my site'.",
            inputSchema: {
              type: "object",
              properties: {
                productUrl: { type: "string", description: "Public https URL of the product to test." },
                goal: { type: "string", description: "What the founder wants testers to verify." },
                budgetUsd: { type: "number", description: "Total testing budget in USDC." },
              },
              required: ["productUrl"],
            },
          }),
        ],
        tool_choice: "auto",
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // Throw the SAME shape production throws, so withTransientRetry classifies a 429 or 5xx as
      // transient and waits properly instead of hammering a concurrency-capped key.
      throw new Error(`llm_status_${res.status} ${body.slice(0, 160)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { tool_calls?: ToolCall[]; content?: string | null }; finish_reason?: string }[];
      usage?: { completion_tokens?: number };
    };
    const ch = data.choices?.[0];
    const msg = ch?.message;
    return {
      call: msg?.tool_calls?.[0] ?? null,
      reply: (msg?.content ?? "").trim(),
      failed: false,
      // finish_reason is the ONLY reliable truncation signal. Without it I twice diagnosed
      // truncation from a reply my own logger had shortened to 240 chars.
      finish: ch?.finish_reason,
      outTokens: data.usage?.completion_tokens,
    };
  } catch (e) {
    return { call: null, reply: "", failed: true, why: e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 180) : String(e).slice(0, 180) };
  }
}

const usd = (base: bigint): number => Number(base) / 1_000_000;

export async function runDirectEval(opts: {
  fixtures: DirectFixture[];
  runs?: number;
  timeoutMs?: number;
  /** gap between fixtures — the shared key caps concurrency at 1 (see askModelWithRetry). */
  paceMs?: number;
  log?: (line: string) => void;
}): Promise<{ rows: DirectRow[]; metrics: DirectMetrics }> {
  const runs = Math.max(1, opts.runs ?? 1);
  const log = opts.log ?? (() => {});
  const rows: DirectRow[] = [];
  let providerFailures = 0;

  for (const f of opts.fixtures) {
    for (let r = 0; r < runs; r++) {
      const violations: string[] = [];
      let { call, reply, failed, why, finish, outTokens } = await askModelWithRetry(f.utterance, opts.timeoutMs ?? 60_000);
      /**
       * PRODUCTION SELF-CORRECTS; A ONE-SHOT BATTERY DOES NOT.
       *
       * When a turn claims an action but runs no tool, the concierge feeds its own SYSTEM CHECK
       * back and gives the model one more round to earn the claim. Measuring a single call reports
       * routing failures a founder never experiences — P-ROUTE made exactly this mistake and
       * over-reported until it modelled the loop.
       *
       * It is not a free pass: the narration guard must independently judge the reply as an
       * UNBACKED CLAIM. A turn that honestly asks a question ("what's the amount per milestone?")
       * trips nothing and still counts as no-tool, which for a vague fixture is the CORRECT answer.
       */
      if (!failed && !call && reply) {
        const verdict = checkNarration(stripReasoningPrefix(reply), new Set<string>());
        if (!verdict.ok) {
          const corrected = await askModelWithRetry(f.utterance, opts.timeoutMs ?? 60_000, 3, [
            { role: "assistant", content: reply },
            { role: "user", content: `SYSTEM CHECK: your draft stated ${verdict.unbacked.join(" and ")} but no tool ran this turn to back it. Do not apologise and do not repeat the claim from memory. Call the right tool NOW and answer only from its result.` },
          ]);
          if (corrected.call) ({ call, reply, finish, outTokens } = corrected);
        }
      }
      if (failed) {
        providerFailures += 1;
        log(`  ${f.id} run${r + 1}/${runs}: PROVIDER FAILURE (not evidence) — ${why ?? "unknown"}`);
        continue;
      }
      const name = call?.function?.name ?? null;
      const calledTool = name === "sage_create_direct_campaign";
      const routedOk =
        f.expect === "either" ? true : f.expect === "direct" ? calledTool : !calledTool;
      if (!routedOk) {
        violations.push(
          `${f.id}: expected ${f.expect} but the model called ${name ?? "no tool"}`,
        );
      }

      const row: DirectRow = {
        fixtureId: f.id,
        category: f.category,
        calledTool,
        routedOk,
        compiled: false,
        budgetExact: null,
        totalUsd: null,
        milestones: null,
        amountFaithful: null,
        countFaithful: null,
        allVerifiable: null,
        lintNotes: [],
        error: null,
        reply: calledTool ? "" : reply.slice(0, 240),
        replyLen: reply.length,
        rawArgs: "",
        correctionRounds: 0,
        violations,
      };

      if (calledTool) {
        try {
          let raw = JSON.parse(call?.function?.arguments ?? "{}") as Record<string, unknown>;
          let parsed = directCampaignSchema.safeParse(mapDirectCampaignArgs(raw));

          /**
           * PRODUCTION LETS THE MODEL CORRECT ITSELF. The concierge runs a bounded tool loop: a
           * failed call returns an actionable error and the model calls again. Measuring only the
           * FIRST shot therefore reports defects a founder would never see — the battery has to
           * exercise the same loop it is judging. One correction round, mirroring the real budget.
           */
          if (!parsed.success) {
            const errText = parsed.error.issues
              .slice(0, 8)
              .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
              .join("; ");
            row.correctionRounds = 1;
            const retry = await askModelWithRetry(f.utterance, opts.timeoutMs ?? 60_000, 3, [
              { role: "assistant", content: null, tool_calls: [call as ToolCall] },
              {
                role: "tool",
                tool_call_id: (call as { id?: string })?.id ?? "call_0",
                content: JSON.stringify({
                  ok: false,
                  error: `The campaign isn't valid yet. Fix ALL of these in ONE corrected call: ${errText}. Every milestone needs rewardUsd and slots.`,
                }),
              } as Msg,
            ]);
            if (retry.call?.function?.name === "sage_create_direct_campaign") {
              raw = JSON.parse(retry.call.function.arguments ?? "{}") as Record<string, unknown>;
              parsed = directCampaignSchema.safeParse(mapDirectCampaignArgs(raw));
            }
          }

          if (!parsed.success) {
            // ALL issues, not the first two: truncating hid the criteria/evidence defects behind
            // the title/productUrl ones for two whole rounds.
            row.error = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
            // and the RAW shape, because guessing what a model wrote is how instruments lie.
            row.rawArgs = JSON.stringify(raw).slice(0, 700);
            violations.push(`${f.id}: model args failed the schema — ${row.error}`);
          } else {
            const input: DirectCampaignInput = parsed.data;
            const compiled = compileDirectCampaign(input, `pdirect-${f.id}-${r}`);
            if (!compiled.ok) {
              row.error = compiled.error;
              violations.push(`${f.id}: compiler refused — ${compiled.error}`);
            } else {
              row.compiled = true;
              row.milestones = input.milestones.length;
              row.totalUsd = usd(compiled.totalBudgetBase);
              // THE frozen invariant: the sum of the parts IS the budget, exactly.
              const sum = input.milestones.reduce(
                (acc, m) => acc + BigInt(Math.round(m.rewardUsd * 100)) * BigInt(10_000) * BigInt(m.slots),
                BigInt(0),
              );
              row.budgetExact = sum === compiled.totalBudgetBase;
              if (!row.budgetExact) violations.push(`${f.id}: BUDGET INVARIANT BROKEN`);

              if (f.statedAmountUsd != null) {
                row.amountFaithful = Math.abs(row.totalUsd - f.statedAmountUsd) < 0.005;
                if (!row.amountFaithful) {
                  violations.push(
                    `${f.id}: founder said $${f.statedAmountUsd}, plan totals $${row.totalUsd}`,
                  );
                }
              }
              if (f.statedMilestones != null) {
                row.countFaithful = input.milestones.length === f.statedMilestones;
                if (!row.countFaithful) {
                  violations.push(
                    `${f.id}: founder described ${f.statedMilestones} milestone(s), plan has ${input.milestones.length}`,
                  );
                }
              }
              row.allVerifiable = input.milestones.every((m) => !!m.evidence);
              if (!row.allVerifiable) violations.push(`${f.id}: a milestone has no verification contract`);
              row.lintNotes = lintDirectCampaign(input);
            }
          }
        } catch (e) {
          row.error = e instanceof Error ? e.message : String(e);
          violations.push(`${f.id}: unparseable tool arguments — ${row.error}`);
        }
      }

      rows.push(row);
      // The gateway allows ONE concurrent call on this key and the LIVE concierge shares it, so a
      // battery that runs flat out degrades the product it is measuring. Breathe between fixtures.
      await new Promise((r) => setTimeout(r, opts.paceMs ?? 1_500));
      log(
        `  ${f.id} run${r + 1}/${runs}: ${calledTool ? "direct" : name ?? "no-tool"}` +
          `${row.compiled ? ` · $${row.totalUsd} · ${row.milestones}m` : ""}` +
          `${violations.length ? `  ⚠ ${violations.length}` : "  ok"}` +
          `${row.lintNotes.length ? ` · lint:${row.lintNotes.length}` : ""}` +
          `${!calledTool ? ` · finish=${finish ?? "?"} outTokens=${outTokens ?? "?"}` : ""}` +
          // 160 chars was not enough to tell WHY a no-tool row happened: the reply opens with the model's
        // <think> monologue, so the decisive part — whether it CLAIMED it would set the campaign up
        // (which the narration guard should catch and self-correct) or honestly asked a question —
        // sits past the cut. Diagnosing from a truncated log is how the last two rounds went wrong.
        `${!calledTool && row.reply ? `\n      reply(${row.replyLen} chars): ${row.reply.slice(0, 900)}` : ""}`,
      );
    }
  }

  const all = rows.flatMap((r) => r.violations);
  const metrics: DirectMetrics = {
    fixtures: opts.fixtures.length,
    runs,
    rows: rows.length,
    routedWrong: rows.filter((r) => !r.routedOk).length,
    compileFailures: rows.filter((r) => r.calledTool && !r.compiled).length,
    budgetViolations: rows.filter((r) => r.budgetExact === false).length,
    amountDrift: rows.filter((r) => r.amountFaithful === false).length,
    inventedMilestones: rows.filter((r) => r.countFaithful === false).length,
    unverifiableMissions: rows.filter((r) => r.allVerifiable === false).length,
    providerFailures,
    conclusive: providerFailures === 0,
    violations: all,
  };
  return { rows, metrics };
}
