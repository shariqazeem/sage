import "server-only";

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * WHAT SAGE'S BRAIN COSTS, AND A CEILING IT CANNOT CROSS (6 Nov 2026).
 *
 * Until today nothing in Sage knew what a model call cost. About $90 of a $100 credit went in two days,
 * and the only record was the provider's console. The wire (wire.ts) now reads each answer's own `usage`,
 * prices it from the table below, and keeps a running total for each provider account per UTC day.
 *
 * With LLM_DAILY_BUDGET_USD set, each account's day total is a ceiling, enforced by priority. The money
 * path is the last thing that ever stops:
 *   - background design (mission brain, field test, inspection): stops at 1× the budget;
 *   - a person waiting (drafting, the Telegram concierge): stops at 1.5×;
 *   - judgment (the payout judge, the observation judge, the eyes it uses): stops at 2×.
 *
 * A refused call is answered like an empty account: a 402 that no caller retries. Every caller already
 * knows what to do with that: the judge holds the work for review, and design waits. At 00:00 UTC the
 * ceiling resets, and the sweep re-judges whatever was held.
 *
 * Prices are USD per million tokens, from the providers' own price lists (6 Nov 2026). An unknown model is
 * priced like the dearest one Sage is ever pointed at, so the meter can only over-count, never under-count.
 * Without the env var the meter still runs, so the operator can always ask what a day cost
 * (`node scripts/vm/llm-spend.mjs`).
 */

export type SpendPriority = "interactive" | "judgment" | "background";

interface Price {
  input: number;
  output: number;
  /** above this many prompt tokens a long-context rate card applies (Haiku 5.5). */
  longAbove?: number;
  inputLong?: number;
  outputLong?: number;
}

const PRICES: { match: RegExp; price: Price }[] = [
  { match: /claude-haiku-5/i, price: { input: 0.1, output: 0.5, longAbove: 100_000, inputLong: 0.5, outputLong: 2.5 } },
  { match: /claude-sonnet-5/i, price: { input: 2, output: 10 } },
  { match: /claude-opus-5/i, price: { input: 4, output: 20 } },
  { match: /claude-fable-5/i, price: { input: 10, output: 50 } },
  { match: /minimax/i, price: { input: 0.3, output: 1.2 } },
  { match: /gemini[^/]*flash-lite/i, price: { input: 0.25, output: 1.5 } },
];
/** An unknown model is priced like Opus 5.5: over-counting is safe, under-counting drains an account. */
const UNKNOWN: Price = { input: 4, output: 20 };

export function priceOf(model: string): Price {
  return PRICES.find((p) => p.match.test(model))?.price ?? UNKNOWN;
}

/**
 * The cost of one answer in micro-USD. Price per million tokens × tokens = micro-USD exactly, so no rounding
 * creeps in between the price list and the ledger. Rounded UP, so a cheap call never counts as free.
 */
export function costMicroUsd(model: string, promptTokens: number, completionTokens: number): number {
  const p = priceOf(model);
  const long = p.longAbove !== undefined && promptTokens > p.longAbove;
  const inRate = long ? (p.inputLong ?? p.input) : p.input;
  const outRate = long ? (p.outputLong ?? p.output) : p.output;
  return Math.ceil(Math.max(0, promptTokens) * inRate + Math.max(0, completionTokens) * outRate);
}

/**
 * The tokens an answer says it used. OpenAI-compatible providers (CommonStack, Anthropic's compatible
 * endpoint) say prompt_tokens / completion_tokens; Anthropic's own shape says input_tokens / output_tokens.
 * An answer that says nothing is estimated from the characters sent and received (about 3 per token, which
 * over-counts English), so a provider that stops reporting usage cannot make the meter read zero.
 */
export function usageOf(responseText: string, sentChars: number): { promptTokens: number; completionTokens: number; estimated: boolean } {
  try {
    const u = (JSON.parse(responseText) as { usage?: Record<string, unknown> }).usage;
    const prompt = Number(u?.prompt_tokens ?? u?.input_tokens);
    const completion = Number(u?.completion_tokens ?? u?.output_tokens);
    if (Number.isFinite(prompt) && Number.isFinite(completion)) {
      return { promptTokens: prompt, completionTokens: completion, estimated: false };
    }
  } catch {
    /* fall through to the estimate */
  }
  return { promptTokens: Math.ceil(sentChars / 3), completionTokens: Math.ceil(responseText.length / 3), estimated: true };
}

// ───────────────────────────── THE BOOK ─────────────────────────────

interface Bucket {
  usdMicro: number;
  calls: number;
}
interface AccountDay extends Bucket {
  host: string;
  /** spend per lane (PAYOUT, DRAFT, …), or per priority when a caller named no lane. */
  lanes: Record<string, Bucket>;
}
/** day (YYYY-MM-DD, UTC) → account id (host|key hash, never the key) → spend. */
type Book = Record<string, Record<string, AccountDay>>;

export interface BudgetEvent {
  day: string;
  host: string;
  account: string;
  priority: SpendPriority;
  spentMicro: number;
  budgetMicro: number;
}

interface SpendStore {
  book: Book;
  loadedFrom: string | null | undefined;
  /** `${day}|${account}|${priority}` already announced. */
  tripped: Set<string>;
  listeners: Set<(e: BudgetEvent) => void>;
}
const g = globalThis as typeof globalThis & { __sageLlmSpend?: SpendStore };
const store: SpendStore = (g.__sageLlmSpend ??= { book: {}, loadedFrom: undefined, tripped: new Set(), listeners: new Set() });

/** Days of history the file keeps. */
const KEEP_DAYS = 31;

/** Where the book lives. Never written by the suite unless a test names a path. */
function bookPath(): string | null {
  if (process.env.LLM_SPEND_PATH) return process.env.LLM_SPEND_PATH;
  if (process.env.VITEST) return null;
  return join(process.cwd(), "var", "llm-spend.json");
}

function load(): void {
  const path = bookPath();
  if (store.loadedFrom === path) return;
  store.loadedFrom = path;
  store.book = {};
  if (!path || !existsSync(path)) return;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { days?: Book };
    if (parsed && typeof parsed.days === "object" && parsed.days) store.book = parsed.days;
  } catch {
    /* a damaged book starts again rather than stopping every model call */
  }
}

function save(): void {
  const path = bookPath();
  if (!path) return;
  const days = Object.keys(store.book).sort();
  for (const d of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete store.book[d];
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ days: store.book }), { mode: 0o600 });
    renameSync(tmp, path);
  } catch {
    /* the meter must never be the reason a call fails */
  }
}

export const dayOf = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);

/** Record one answered call. Returns what it cost (micro-USD). */
export function recordSpend(
  e: { account: string; host: string; model: string; lane: string; responseText: string; sentChars: number },
  nowMs = Date.now(),
): number {
  load();
  const u = usageOf(e.responseText, e.sentChars);
  const cost = costMicroUsd(e.model, u.promptTokens, u.completionTokens);
  const day = dayOf(nowMs);
  const accounts = (store.book[day] ??= {});
  const a = (accounts[e.account] ??= { host: e.host, usdMicro: 0, calls: 0, lanes: {} });
  a.usdMicro += cost;
  a.calls += 1;
  const lane = (a.lanes[e.lane] ??= { usdMicro: 0, calls: 0 });
  lane.usdMicro += cost;
  lane.calls += 1;
  save();
  return cost;
}

/** Today's spend on one account (micro-USD). */
export function spentToday(account: string, nowMs = Date.now()): number {
  load();
  return store.book[dayOf(nowMs)]?.[account]?.usdMicro ?? 0;
}

// ───────────────────────────── THE CEILING ─────────────────────────────

/** How far past the daily budget each kind of work may go. The money path stops last. */
export const CEILING: Record<SpendPriority, number> = { background: 1, interactive: 1.5, judgment: 2 };

export function dailyBudgetMicro(): number | null {
  const raw = Number(process.env.LLM_DAILY_BUDGET_USD);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 1_000_000) : null;
}

/**
 * Should this call be refused for today's budget? Null when it may go. Announces each (day, account,
 * priority) the first time it trips, so the operator hears it once rather than once per call.
 */
export function overBudget(account: string, host: string, priority: SpendPriority, nowMs = Date.now()): BudgetEvent | null {
  const budget = dailyBudgetMicro();
  if (budget === null) return null;
  const spent = spentToday(account, nowMs);
  if (spent < budget * CEILING[priority]) return null;
  const e: BudgetEvent = { day: dayOf(nowMs), host, account, priority, spentMicro: spent, budgetMicro: budget };
  const k = `${e.day}|${account}|${priority}`;
  if (!store.tripped.has(k)) {
    store.tripped.add(k);
    for (const fn of store.listeners) {
      try {
        fn(e);
      } catch {
        /* a listener's failure is its own */
      }
    }
  }
  return e;
}

export function onBudgetTrip(fn: (e: BudgetEvent) => void): () => void {
  store.listeners.add(fn);
  return () => store.listeners.delete(fn);
}

export const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(micro < 10_000_000 ? 3 : 2)}`;

/** What each kind of work does once its ceiling is reached, in the operator's words. */
export const PAUSES: Record<SpendPriority, string> = {
  background: "Background design (missions, product tests) waits",
  interactive: "Drafting and Telegram replies wait",
  judgment: "Judging waits too: work is held for review, never paid without a judgment",
};

/** The operator's message when a ceiling trips. Pure, for the suite. */
export function budgetAlertText(e: BudgetEvent): string {
  const ceiling = Math.round(e.budgetMicro * CEILING[e.priority]);
  return [
    "<b>Sage's model budget for today is reached</b>",
    `${e.host}: ${usd(e.spentMicro)} spent today, against a ${usd(e.budgetMicro)} daily budget (this kind of work stops at ${usd(ceiling)}).`,
    `${PAUSES[e.priority]} until 00:00 UTC. Nothing is lost: held work is re-judged after the reset.`,
  ].join("\n");
}

/** A day's book, for the operator's report and the health line. Hosts and key ids only, never a key. */
export function spendReport(nowMs = Date.now()): { day: string; accounts: { account: string; host: string; usd: string; calls: number; lanes: Record<string, string> }[] } {
  load();
  const day = dayOf(nowMs);
  const accounts = Object.entries(store.book[day] ?? {}).map(([account, a]) => ({
    account: account.split("|")[1] ?? account,
    host: a.host,
    usd: usd(a.usdMicro),
    calls: a.calls,
    lanes: Object.fromEntries(Object.entries(a.lanes).map(([l, b]) => [l, `${usd(b.usdMicro)} / ${b.calls}`])),
  }));
  return { day, accounts };
}

/** Test seam. */
export function resetSpend(): void {
  store.book = {};
  store.loadedFrom = undefined;
  store.tripped.clear();
  store.listeners.clear();
}
