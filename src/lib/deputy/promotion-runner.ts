/**
 * Resumable, rate-limit-honest orchestrator for the manual PROMOTION evals (P-JUDGE / P-ENTAIL) — Gate C
 * item 6.
 *
 * A promotion decision must rest on the required number of VALID responses from the ACTUAL candidate model.
 * Rate-limited, heuristic-fallback, or transport-failed rows can NEVER fill that quota. This orchestrator
 * enforces that and the surrounding hygiene: a one-request quota probe first (stop immediately on 429),
 * concurrency 1, a configurable minimum interval, bounded exponential backoff with jitter that respects
 * Retry-After, a hard request/cost budget, checkpointing after every result, and --resume. It NEVER retries
 * a semantically-valid model response (a real decision, even a "bad" one, is a data point — not a retry).
 *
 * Pure logic: the clock, sleep, RNG (jitter), the per-call worker, and the checkpoint store are all
 * injected, so the whole policy is unit-testable without a network or real time.
 */

export type CallOutcome =
  /** a real model decision — counts toward the quota; NEVER retried. */
  | { kind: "valid"; costUsd?: number; detail?: string }
  /** the model responded but the decision is semantically unusable (unparseable/incomplete). A real data
   *  point about the model — counts as an ANSWERED slot and is NEVER retried. */
  | { kind: "model_failure"; costUsd?: number; detail?: string }
  /** HTTP 429 — retry with backoff, honoring Retry-After. Does NOT count toward the quota. */
  | { kind: "rate_limited"; retryAfterMs?: number; detail?: string }
  /** a transport failure (timeout / 5xx / connection) — retry with backoff. Does NOT count toward the quota. */
  | { kind: "transient"; detail?: string };

export interface FixtureRef {
  id: string;
}

export interface Checkpoint {
  /** completed (fixtureId, runIndex) slots and their outcome kind — so a resume skips them. */
  done: { fixtureId: string; run: number; kind: "valid" | "model_failure" }[];
  requests: number;
  costUsd: number;
}

export interface PromotionRunnerOptions {
  fixtures: FixtureRef[];
  /** required responses per fixture (a "run" is one answered slot: valid or model_failure). */
  runsPerFixture: number;
  /** one attempt at one fixture; returns a classified outcome. MUST NOT retry internally. */
  runOne: (fixtureId: string, run: number) => Promise<CallOutcome>;
  concurrency?: number; // default + max 1 for a promotion run (deliberate — no burst on a shared quota)
  minIntervalMs?: number; // minimum gap between the START of successive requests
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  maxRetriesPerSlot?: number; // bounded retries for rate_limited/transient before giving up the run
  budget?: { maxRequests?: number; maxCostUsd?: number };
  checkpoint?: { load: () => Checkpoint | null; save: (c: Checkpoint) => void };
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  rng?: () => number; // [0,1) for jitter; injected in tests
  log?: (line: string) => void;
}

export type RunStatus = "conclusive" | "quota_blocked" | "budget_exhausted" | "incomplete";

export interface PromotionRunResult {
  status: RunStatus;
  /** the run is valid promotion evidence ONLY when conclusive. */
  conclusive: boolean;
  validResponses: number;
  modelFailures: number;
  requiredResponses: number; // fixtures × runsPerFixture
  requests: number;
  costUsd: number;
  /** when quota_blocked, the earliest safe retry (ms from the epoch of `now`), if the provider told us. */
  retryAfterMs?: number;
  reason: string;
}

const DEFAULTS = { baseBackoffMs: 1_000, maxBackoffMs: 60_000, maxRetriesPerSlot: 4, minIntervalMs: 0 };

/**
 * Run the promotion eval. Starts with a QUOTA PROBE (one request): if it is rate-limited, stop immediately
 * and report the earliest safe retry — never grind a loop against a throttled account. Otherwise proceed
 * slot by slot, checkpointing after each answered slot, until every required VALID response is collected
 * (conclusive), the budget is exhausted, or a slot exhausts its bounded retries (incomplete).
 */
export async function runPromotionEval(opts: PromotionRunnerOptions): Promise<PromotionRunResult> {
  const baseBackoff = opts.baseBackoffMs ?? DEFAULTS.baseBackoffMs;
  const maxBackoff = opts.maxBackoffMs ?? DEFAULTS.maxBackoffMs;
  const maxRetries = opts.maxRetriesPerSlot ?? DEFAULTS.maxRetriesPerSlot;
  const minInterval = opts.minIntervalMs ?? DEFAULTS.minIntervalMs;
  const rng = opts.rng ?? Math.random;
  const log = opts.log ?? (() => {});
  const required = opts.fixtures.length * opts.runsPerFixture;

  const cp: Checkpoint = opts.checkpoint?.load() ?? { done: [], requests: 0, costUsd: 0 };
  const doneKey = (fixtureId: string, run: number) => `${fixtureId}#${run}`;
  const doneSet = new Set(cp.done.map((d) => doneKey(d.fixtureId, d.run)));
  let requests = cp.requests;
  let costUsd = cp.costUsd;
  let lastStart = -Infinity;

  const overBudget = () =>
    (opts.budget?.maxRequests != null && requests >= opts.budget.maxRequests) ||
    (opts.budget?.maxCostUsd != null && costUsd >= opts.budget.maxCostUsd);

  // backoff for the Nth retry (1-based), exp + full jitter, honoring an explicit Retry-After.
  const backoffMs = (attempt: number, retryAfterMs?: number) => {
    if (retryAfterMs != null) return retryAfterMs;
    const capped = Math.min(maxBackoff, baseBackoff * 2 ** (attempt - 1));
    return Math.floor(capped * rng()); // full jitter
  };

  const pace = async () => {
    if (minInterval > 0) {
      const wait = lastStart + minInterval - opts.now();
      if (wait > 0) await opts.sleep(wait);
    }
    lastStart = opts.now();
  };

  const finish = (status: RunStatus, reason: string, retryAfterMs?: number): PromotionRunResult => {
    const validResponses = cp.done.filter((d) => d.kind === "valid").length;
    const modelFailures = cp.done.filter((d) => d.kind === "model_failure").length;
    opts.checkpoint?.save({ done: cp.done, requests, costUsd });
    return {
      status,
      conclusive: status === "conclusive",
      validResponses,
      modelFailures,
      requiredResponses: required,
      requests,
      costUsd: Number(costUsd.toFixed(6)),
      retryAfterMs,
      reason,
    };
  };

  let probed = false;
  for (const f of opts.fixtures) {
    for (let run = 0; run < opts.runsPerFixture; run++) {
      if (doneSet.has(doneKey(f.id, run))) continue; // resumed
      // Attempt this slot with bounded retries for rate-limit/transient only.
      let slotDone = false;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (overBudget()) return finish("budget_exhausted", `budget reached (${requests} req, $${costUsd.toFixed(4)})`);
        await pace();
        const outcome = await opts.runOne(f.id, run);
        requests++;
        const isQuotaProbe = !probed; // the very FIRST request of the whole run is the probe
        probed = true;

        if (outcome.kind === "valid" || outcome.kind === "model_failure") {
          costUsd += outcome.costUsd ?? 0;
          cp.done.push({ fixtureId: f.id, run, kind: outcome.kind });
          opts.checkpoint?.save({ done: cp.done, requests, costUsd });
          log(`  ${f.id}#${run}: ${outcome.kind}${outcome.detail ? ` (${outcome.detail})` : ""}`);
          slotDone = true;
          break;
        }

        // QUOTA PROBE: if the very first request is 429, stop the whole run — never grind a throttled account.
        if (isQuotaProbe && outcome.kind === "rate_limited") {
          const ra = outcome.retryAfterMs;
          log(`quota probe hit 429 — stopping. earliest retry ${ra != null ? `${Math.ceil(ra / 1000)}s` : "unknown"}.`);
          return finish("quota_blocked", "quota probe was rate-limited (429) — do not loop a throttled account", ra);
        }
        if (attempt < maxRetries) {
          const wait = backoffMs(attempt + 1, outcome.kind === "rate_limited" ? outcome.retryAfterMs : undefined);
          log(`  ${f.id}#${run}: ${outcome.kind} — backoff ${Math.ceil(wait / 1000)}s (retry ${attempt + 1}/${maxRetries})`);
          await opts.sleep(wait);
        }
      }
      if (!slotDone) return finish("incomplete", `slot ${f.id}#${run} exhausted ${maxRetries} retries without a valid model response`);
    }
  }

  const validResponses = cp.done.filter((d) => d.kind === "valid").length;
  return finish(
    validResponses >= required ? "conclusive" : "incomplete",
    validResponses >= required
      ? `conclusive: ${validResponses}/${required} valid model responses`
      : `incomplete: only ${validResponses}/${required} valid (model failures do not fill the quota)`,
  );
}
