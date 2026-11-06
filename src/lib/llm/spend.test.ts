import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  budgetAlertText,
  CEILING,
  costMicroUsd,
  onBudgetTrip,
  overBudget,
  recordSpend,
  resetSpend,
  spendReport,
  spentToday,
  usageOf,
  type BudgetEvent,
} from "./spend";
import { postChat, resetWireMemory } from "./wire";

/**
 * WHAT SAGE'S BRAIN COSTS, AND THE CEILING (spend.ts).
 *
 * 5-6 Nov 2026: ~$90 of a $100 Claude credit went in two days and nothing in Sage could say where. These hold
 * the meter (every answer priced from its own usage, an unknown model over-counted) and the ceiling (the
 * money path stops last, and a refused call never reaches the network).
 */

const P = { endpoint: "https://api.anthropic.com/v1/chat/completions", key: "sk-ant-test-0001", model: "claude-sonnet-5-5", host: "api.anthropic.com" };
const answer = (prompt: number, completion: number) =>
  JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: prompt, completion_tokens: completion } });

function countingFetch(body: string) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

beforeEach(() => {
  resetSpend();
  resetWireMemory();
});
afterEach(() => {
  delete process.env.LLM_DAILY_BUDGET_USD;
  delete process.env.LLM_SPEND_PATH;
  resetSpend();
});

describe("pricing an answer", () => {
  it("prices per million tokens into micro-USD exactly", () => {
    // Sonnet 5.5: $2 in, $10 out per million → 10,000 in + 2,000 out = 2¢ + 2¢
    expect(costMicroUsd("claude-sonnet-5-5", 10_000, 2_000)).toBe(40_000);
    // the gateway's spelling of the same model is the same price
    expect(costMicroUsd("anthropic/claude-sonnet-5-5", 10_000, 2_000)).toBe(40_000);
  });

  it("uses Haiku 5.5's long-context card above 100K prompt tokens", () => {
    expect(costMicroUsd("claude-haiku-5-5", 100_000, 1_000)).toBe(100_000 * 0.1 + 1_000 * 0.5);
    expect(costMicroUsd("claude-haiku-5-5", 100_001, 1_000)).toBe(Math.ceil(100_001 * 0.5 + 1_000 * 2.5));
  });

  it("over-counts a model it does not know, never under-counts it", () => {
    const unknown = costMicroUsd("some-new-model-9", 10_000, 2_000);
    for (const known of ["claude-sonnet-5-5", "minimax/minimax-m3", "google/gemini-3.1-flash-lite", "claude-haiku-5-5"]) {
      expect(unknown).toBeGreaterThan(costMicroUsd(known, 10_000, 2_000));
    }
  });

  it("reads both usage spellings, and estimates when a provider reports none", () => {
    expect(usageOf(answer(120, 30), 0)).toEqual({ promptTokens: 120, completionTokens: 30, estimated: false });
    expect(usageOf(JSON.stringify({ usage: { input_tokens: 7, output_tokens: 3 } }), 0)).toMatchObject({ promptTokens: 7, completionTokens: 3 });
    const silent = usageOf(JSON.stringify({ choices: [] }), 3_000);
    expect(silent.estimated).toBe(true);
    expect(silent.promptTokens).toBe(1_000); // a provider that stops reporting cannot make the meter read zero
  });
});

describe("the book", () => {
  it("books a day per account and per lane, and starts a new day at 00:00 UTC", () => {
    const day1 = Date.parse("2026-11-06T23:59:00Z");
    const day2 = Date.parse("2026-11-07T00:01:00Z");
    const e = { account: "api.anthropic.com|abc", host: "api.anthropic.com", model: "claude-sonnet-5-5", sentChars: 0 };
    recordSpend({ ...e, lane: "PAYOUT", responseText: answer(10_000, 2_000) }, day1);
    recordSpend({ ...e, lane: "DRAFT", responseText: answer(10_000, 2_000) }, day1);
    expect(spentToday(e.account, day1)).toBe(80_000);
    expect(spentToday(e.account, day2)).toBe(0);
    const r = spendReport(day1);
    expect(r.accounts[0]).toMatchObject({ host: "api.anthropic.com", account: "abc", calls: 2 });
    expect(Object.keys(r.accounts[0]!.lanes).sort()).toEqual(["DRAFT", "PAYOUT"]);
  });

  it("survives a restart: the day's total is read back from the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "sage-spend-"));
    try {
      process.env.LLM_SPEND_PATH = join(dir, "llm-spend.json");
      const now = Date.parse("2026-11-06T12:00:00Z");
      recordSpend({ account: "h|k", host: "h", model: "claude-sonnet-5-5", lane: "MISSION", responseText: answer(50_000, 5_000), sentChars: 0 }, now);
      expect(JSON.parse(readFileSync(process.env.LLM_SPEND_PATH, "utf8")).days["2026-11-06"]["h|k"].usdMicro).toBe(150_000);
      resetSpend(); // a new process
      expect(spentToday("h|k", now)).toBe(150_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never holds a key: accounts are host and key hash", async () => {
    const f = countingFetch(answer(10, 10));
    await postChat(P, { model: P.model, messages: [] }, { timeoutMs: 5_000, priority: "judgment", lane: "PAYOUT", fetchImpl: f.impl });
    expect(JSON.stringify(spendReport())).not.toContain(P.key);
  });
});

describe("the ceiling", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  const fill = (micro: number) =>
    // $2/M input on Sonnet: `micro / 2` prompt tokens cost exactly `micro`
    recordSpend({ account: "h|k", host: "h", model: "claude-sonnet-5-5", lane: "MISSION", responseText: answer(micro / 2, 0), sentChars: 0 }, now);

  it("does nothing without a budget: the meter only counts", () => {
    fill(50_000_000);
    expect(overBudget("h|k", "h", "background", now)).toBeNull();
  });

  it("stops background design first, a waiting person next, and judgment last", () => {
    process.env.LLM_DAILY_BUDGET_USD = "1";
    fill(1_000_000); // exactly the budget
    expect(overBudget("h|k", "h", "background", now)).not.toBeNull();
    expect(overBudget("h|k", "h", "interactive", now)).toBeNull();
    expect(overBudget("h|k", "h", "judgment", now)).toBeNull();
    fill(500_000); // 1.5×
    expect(overBudget("h|k", "h", "interactive", now)).not.toBeNull();
    expect(overBudget("h|k", "h", "judgment", now)).toBeNull();
    fill(500_000); // 2×
    expect(overBudget("h|k", "h", "judgment", now)).not.toBeNull();
    expect(CEILING.background < CEILING.interactive && CEILING.interactive < CEILING.judgment).toBe(true);
  });

  it("is per account: one empty budget does not stop another provider", () => {
    process.env.LLM_DAILY_BUDGET_USD = "1";
    fill(5_000_000);
    expect(overBudget("other|k2", "other", "background", now)).toBeNull();
  });

  it("tells the operator once per day and kind of work, not once per call", () => {
    process.env.LLM_DAILY_BUDGET_USD = "1";
    const heard: BudgetEvent[] = [];
    const off = onBudgetTrip((e) => heard.push(e));
    fill(1_000_000);
    overBudget("h|k", "h", "background", now);
    overBudget("h|k", "h", "background", now);
    off();
    expect(heard).toHaveLength(1);
    const text = budgetAlertText(heard[0]!);
    expect(text).toContain("$1.000 spent today");
    expect(text).toContain("00:00 UTC");
  });

  it("a refused call never reaches the network, and reads as an empty account (402, never retried)", async () => {
    process.env.LLM_DAILY_BUDGET_USD = "0.01";
    const f = countingFetch(answer(20_000, 0)); // 4¢ on Sonnet: past even judgment's 2× of 1¢
    const first = await postChat(P, { model: P.model, messages: [] }, { timeoutMs: 5_000, priority: "judgment", lane: "PAYOUT", fetchImpl: f.impl });
    expect(first.ok).toBe(true);
    for (const priority of ["background", "interactive", "judgment"] as const) {
      const res = await postChat(P, { model: P.model, messages: [] }, { timeoutMs: 5_000, priority, fetchImpl: f.impl });
      expect(res).toMatchObject({ ok: false, status: 402, outOfCredit: true });
      expect(JSON.parse(res.text).error.code).toBe("daily_budget");
    }
    expect(f.calls).toHaveLength(1);
  });

  it("lets judgment through while background design is already stopped", async () => {
    process.env.LLM_DAILY_BUDGET_USD = "0.05";
    const f = countingFetch(answer(30_000, 0)); // 6¢: past background (5¢), inside judgment (10¢)
    await postChat(P, { model: P.model, messages: [] }, { timeoutMs: 5_000, priority: "background", lane: "MISSION", fetchImpl: f.impl });
    const design = await postChat(P, { model: P.model, messages: [] }, { timeoutMs: 5_000, priority: "background", fetchImpl: f.impl });
    const judge = await postChat(P, { model: P.model, messages: [] }, { timeoutMs: 5_000, priority: "judgment", fetchImpl: f.impl });
    expect(design.ok).toBe(false);
    expect(judge.ok).toBe(true);
  });
});
