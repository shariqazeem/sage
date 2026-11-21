import "server-only";

/**
 * A MODEL THAT THINKS ITS WHOLE BUDGET AWAY, REMEMBERED (22 Nov 2026).
 *
 * Measured 21 Nov 2026: MiniMax M3 spent all 14,000 completion tokens thinking on the architect prompt and
 * wrote no answer, on prompt v4.6 and v4.7 alike and with `reasoning_effort: "low"`. The ladder read the
 * empty answer as a truncation, gave the same model more room and asked again, up to five times at four to
 * eleven minutes each. More room does not help a model that never starts its answer: it is a property of
 * this model on this prompt, not of the budget.
 *
 * So a think-only answer is its own failure (`llm_think_only`, complete.ts), and it is remembered here per
 * provider, model, lane and prompt tag for a cooling period. While it cools, callers that have a different
 * fallback go to it first (`steady.ts`, the architect, the critic); when the period ends the next job asks
 * the model again, which is the re-probe. A new prompt version is a new tag, so a prompt fix is tried at once.
 *
 * This is routing memory only. It never changes what an answer must be to be accepted.
 */
interface Who {
  host: string;
  model: string;
}
interface Entry {
  until: number;
  count: number;
}
interface HealthStore {
  thinkOnly: Map<string, Entry>;
}
const g = globalThis as typeof globalThis & { __sageModelHealth?: HealthStore };
const store: HealthStore = (g.__sageModelHealth ??= { thinkOnly: new Map() });

/** How long a model that only thought is passed over for that job. A repeat doubles it, up to six hours. */
export function thinkOnlyCoolingMs(): number {
  const raw = Number(process.env.LLM_OVERTHINK_COOLING_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 60 * 60_000;
}
const MAX_COOLING_MS = 6 * 3600_000;

const keyOf = (p: Who, lane: string | undefined, tag: string | undefined) => `${p.host}|${p.model}|${lane ?? "-"}|${tag ?? "-"}`;

/** This model spent its whole budget thinking on this job. */
export function noteThinkOnly(p: Who, lane: string | undefined, tag: string | undefined, now = Date.now()): void {
  const k = keyOf(p, lane, tag);
  const prev = store.thinkOnly.get(k);
  const count = (prev?.count ?? 0) + 1;
  const cooling = Math.min(thinkOnlyCoolingMs() * 2 ** (count - 1), MAX_COOLING_MS);
  store.thinkOnly.set(k, { until: now + cooling, count });
  if (!prev) console.warn(`[llm-health] ${p.host} ${p.model} thought its whole budget away on ${lane ?? "-"}/${tag ?? "-"}; passing it over for ${Math.round(cooling / 60_000)} min where a fallback exists`);
}

/** This model answered this job: whatever was remembered is forgotten. */
export function noteAnsweredJob(p: Who, lane: string | undefined, tag: string | undefined): void {
  store.thinkOnly.delete(keyOf(p, lane, tag));
}

/** Is this model still cooling for this job? Once the period ends, the next caller asks it again. */
export function thinksOnly(p: Who, lane: string | undefined, tag: string | undefined, now = Date.now()): boolean {
  const e = store.thinkOnly.get(keyOf(p, lane, tag));
  return !!e && now < e.until;
}

/** What is being passed over right now, for the operator's status line. */
export function overthinkers(now = Date.now()): { key: string; minutesLeft: number }[] {
  return [...store.thinkOnly.entries()].filter(([, e]) => now < e.until).map(([key, e]) => ({ key, minutesLeft: Math.ceil((e.until - now) / 60_000) }));
}

/** Test seam. */
export function resetModelHealth(): void {
  store.thinkOnly.clear();
}
