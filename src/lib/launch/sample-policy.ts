/**
 * Tester SAMPLE policy — how many independent completions a qualitative mission should buy.
 *
 * A founder who says "make USERS land here and talk to her" is asking about people, plural: one tester's
 * account of a subjective experience is an anecdote, not a finding. So when the request is plural and the
 * work is qualitative (judged from a tester's own account rather than a deterministic URL), Sage prefers a
 * small independent sample — as long as each tester still earns a meaningful reward. It never silently
 * settles for one tester: if the budget cannot fund a meaningful sample, it asks.
 *
 * Pure + deterministic + product-agnostic: no product names, no hardcoded reward amounts (the meaningful
 * floor is the existing budget-layer constant, passed in). Runs BEFORE budget compilation; the exact
 * allocation invariant (Σ rewardBase × maxCompletions === total) is still enforced by allocateBudget.
 */

/** How many independent testers a qualitative, plural request prefers. */
export const PREFERRED_SAMPLE = 3;

export interface SampleMission {
  missionKey: string;
  maxCompletions: number;
  rewardWeight: number;
  /** true when completion is judged from the tester's own account (not a deterministic URL check). */
  qualitative: boolean;
}

export interface SamplePolicyResult<T extends SampleMission> {
  missions: T[];
  /** true when any mission's completion count was raised to the preferred sample. */
  adjusted: boolean;
  /** set when the budget cannot fund a meaningful sample — ask the founder instead of picking one tester. */
  question: string | null;
  /** bounded explanation for telemetry. */
  reason:
    | "not_plural"
    | "not_qualitative"
    | "raised_to_sample"
    | "budget_limited"
    | "already_sampled";
}

const PLURAL =
  /\b(users|testers|participants|people|players|customers|visitors|players|folks|audiences?|everyone|anyone|multiple|several|a few|some)\b/i;

/** Does the founder's request ask about PEOPLE in the plural (a sample), not a single deterministic check? */
export function requestsPluralSample(goal: string): boolean {
  return PLURAL.test(goal ?? "");
}

/**
 * Apply the sample policy to the missions about to be budget-compiled.
 *
 *   · plural + qualitative  → prefer {@link PREFERRED_SAMPLE} independent completions;
 *   · reduce the count only when the per-tester reward would fall below the meaningful floor;
 *   · if not even 2 meaningful completions fit, return a clear budget question rather than
 *     silently selecting a single tester.
 */
export function applySamplePolicy<T extends SampleMission>(
  missions: T[],
  opts: {
    goal: string;
    totalBudgetBase: bigint;
    minRewardBase: bigint;
    preferred?: number;
  },
): SamplePolicyResult<T> {
  const preferred = Math.max(1, opts.preferred ?? PREFERRED_SAMPLE);
  if (missions.length === 0)
    return {
      missions,
      adjusted: false,
      question: null,
      reason: "not_qualitative",
    };
  if (!requestsPluralSample(opts.goal))
    return { missions, adjusted: false, question: null, reason: "not_plural" };

  const totalWeight = missions.reduce(
    (s, m) => s + Math.max(1, m.rewardWeight),
    0,
  );
  let adjusted = false;
  let budgetLimited = false;

  const out = missions.map((m) => {
    if (!m.qualitative) return m;
    if (m.maxCompletions >= preferred) return m;
    // this mission's share of the budget, and how many meaningful rewards it can buy.
    const share =
      (opts.totalBudgetBase * BigInt(Math.max(1, m.rewardWeight))) /
      BigInt(totalWeight);
    const affordable = Number(share / opts.minRewardBase); // whole meaningful rewards this share can fund
    const target = Math.min(preferred, Math.max(1, affordable));
    if (target < preferred) budgetLimited = true;
    if (target > m.maxCompletions) {
      adjusted = true;
      return { ...m, maxCompletions: target };
    }
    return m;
  });

  const anyQualitative = missions.some((m) => m.qualitative);
  if (!anyQualitative)
    return {
      missions,
      adjusted: false,
      question: null,
      reason: "not_qualitative",
    };

  // Could the budget not even fund TWO meaningful completions for a qualitative mission? Then asking is
  // the honest move — a single tester's account is not the sample the founder asked for.
  const worst = out
    .filter((m) => m.qualitative)
    .reduce((min, m) => Math.min(min, m.maxCompletions), Infinity);
  if (worst < 2) {
    const perTester = Number(opts.minRewardBase) / 1_000_000;
    return {
      missions: out,
      adjusted,
      question: `You asked about multiple users, but this budget only funds one meaningful reward (each tester needs at least $${perTester.toFixed(2)}). Do you want to raise the budget so ${preferred} people can each be paid, or run it with a single tester?`,
      reason: "budget_limited",
    };
  }

  if (!adjusted)
    return {
      missions: out,
      adjusted: false,
      question: null,
      reason: "already_sampled",
    };
  return {
    missions: out,
    adjusted: true,
    question: null,
    reason: budgetLimited ? "budget_limited" : "raised_to_sample",
  };
}

/**
 * Split an ALREADY-ALLOCATED mission's pot across the sampled number of testers.
 *
 * `allocateBudget` guarantees exactness by giving the balancer mission a single completion worth the
 * exact remainder — so a one-mission plan always comes back as 1 × the whole budget. This pure transform
 * re-expresses that same pot as N independent completions: `rewardBase × maxCompletions` is UNCHANGED
 * (the exact-allocation invariant still holds bit for bit), it only ever splits when the division is
 * exact and every tester still clears the meaningful floor. Never touches budget math itself.
 */
export function splitCompletionsForSample<
  T extends { missionKey: string; rewardBase: bigint; maxCompletions: bigint },
>(
  allocated: T[],
  targetByKey: ReadonlyMap<string, number>,
  minRewardBase: bigint,
): T[] {
  return allocated.map((m) => {
    const target = targetByKey.get(m.missionKey);
    if (!target || target <= Number(m.maxCompletions)) return m;
    const pot = m.rewardBase * m.maxCompletions;
    const n = BigInt(target);
    if (pot % n !== BigInt(0)) return m; // never introduce rounding
    const reward = pot / n;
    if (reward < minRewardBase) return m; // never drop a tester below the meaningful floor
    return { ...m, rewardBase: reward, maxCompletions: n };
  });
}
