import "server-only";

import { BASE_PROMPT, DIRECT_BLOCK, DIRECT_CAMPAIGN_TOOL } from "@/lib/telegram/concierge";
import { conciergeBase, conciergeKey, conciergeModel } from "@/lib/telegram/concierge-config";
import { mapDirectCampaignArgs } from "@/lib/mcp/server";
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

/** The gateway stalls on roughly a third of calls (documented in concierge.ts). Without the same
 *  bounded retry the battery has, a flaky minute reads as a model-quality result — and a run of
 *  all-failures scores zero violations and "passes" vacuously. Retry, then report honestly. */
async function askModelWithRetry(
  utterance: string,
  timeoutMs: number,
  attempts = 3,
): Promise<{ call: ToolCall | null; failed: boolean }> {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 2_000 * i));
    const out = await askModel(utterance, timeoutMs);
    if (!out.failed) return out;
  }
  return { call: null, failed: true };
}

async function askModel(utterance: string, timeoutMs: number): Promise<{ call: ToolCall | null; failed: boolean }> {
  const key = conciergeKey();
  const base = conciergeBase();
  if (!key) return { call: null, failed: true };
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: conciergeModel(),
        temperature: 0.3,
        max_tokens: 1400,
        messages: [
          { role: "system", content: `${BASE_PROMPT}\n\n${DIRECT_BLOCK}` },
          { role: "user", content: utterance },
        ],
        // Both lanes are offered, because CHOOSING between them is half of what is measured.
        tools: [
          { type: "function", function: DIRECT_CAMPAIGN_TOOL },
          {
            type: "function",
            function: {
              name: "sage_start_inspection",
              description:
                "Start a REAL Sage product-testing inspection for a founder's product URL. Use for 'test my product' / 'get feedback on my site'.",
              parameters: {
                type: "object",
                properties: {
                  productUrl: { type: "string" },
                  goal: { type: "string" },
                  budgetUsd: { type: "number" },
                },
                required: ["productUrl"],
              },
            },
          },
        ],
        tool_choice: "auto",
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { call: null, failed: true };
    const data = (await res.json()) as { choices?: { message?: { tool_calls?: ToolCall[] } }[] };
    const calls = data.choices?.[0]?.message?.tool_calls ?? [];
    return { call: calls[0] ?? null, failed: false };
  } catch {
    return { call: null, failed: true };
  }
}

const usd = (base: bigint): number => Number(base) / 1_000_000;

export async function runDirectEval(opts: {
  fixtures: DirectFixture[];
  runs?: number;
  timeoutMs?: number;
  log?: (line: string) => void;
}): Promise<{ rows: DirectRow[]; metrics: DirectMetrics }> {
  const runs = Math.max(1, opts.runs ?? 1);
  const log = opts.log ?? (() => {});
  const rows: DirectRow[] = [];
  let providerFailures = 0;

  for (const f of opts.fixtures) {
    for (let r = 0; r < runs; r++) {
      const violations: string[] = [];
      const { call, failed } = await askModelWithRetry(f.utterance, opts.timeoutMs ?? 60_000);
      if (failed) {
        providerFailures += 1;
        log(`  ${f.id} run${r + 1}/${runs}: PROVIDER FAILURE (not evidence)`);
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
        violations,
      };

      if (calledTool) {
        try {
          const raw = JSON.parse(call?.function?.arguments ?? "{}") as Record<string, unknown>;
          const parsed = directCampaignSchema.safeParse(mapDirectCampaignArgs(raw));
          if (!parsed.success) {
            row.error = parsed.error.issues.slice(0, 2).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
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
      log(
        `  ${f.id} run${r + 1}/${runs}: ${calledTool ? "direct" : name ?? "no-tool"}` +
          `${row.compiled ? ` · $${row.totalUsd} · ${row.milestones}m` : ""}` +
          `${violations.length ? `  ⚠ ${violations.length}` : "  ok"}` +
          `${row.lintNotes.length ? ` · lint:${row.lintNotes.length}` : ""}`,
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
