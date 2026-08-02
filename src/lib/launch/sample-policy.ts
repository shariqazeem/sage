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

/**
 * EFFORT-ANCHORED REWARD CEILING — what a completion is WORTH, so a fat budget buys a larger sample
 * instead of overpaying a tiny one. The policy used to reason only about sample size and the $0.10
 * floor: a $10 budget with one 5-minute mission became 2 × $5.00 (the largest exact split ≤ 3) —
 * $1/minute, farm bait, and only two data points from a budget that honestly buys ten. A completion's
 * fair ceiling is `effortMinutes × $0.20` (never below the meaningful floor); when a mission's share
 * pays past that ceiling, the target sample grows until each tester earns fair-but-not-absurd money.
 * More testers at fair pay strictly dominates fewer at inflated pay: same spend, more independent
 * evidence, no farming magnet. Missions without an effortMinutes (older callers) keep the old
 * behavior exactly.
 */
export const PER_MINUTE_RATE_BASE = BigInt(200_000); // $0.20 per estimated minute, 6dp base units
/** Hard cap on any derived sample — matches the budget layer's per-mission completion cap. */
const MAX_SAMPLE = 50;

export function effortCeilingBase(
  effortMinutes: number | undefined,
  minRewardBase: bigint,
): bigint | null {
  if (!effortMinutes || !Number.isFinite(effortMinutes) || effortMinutes <= 0) return null;
  const ceiling = BigInt(Math.round(effortMinutes)) * PER_MINUTE_RATE_BASE;
  return ceiling > minRewardBase ? ceiling : minRewardBase;
}

export interface SampleMission {
  missionKey: string;
  maxCompletions: number;
  rewardWeight: number;
  /** true when completion is judged from the tester's own account (not a deterministic URL check). */
  qualitative: boolean;
  /** the mission's estimated effort — arms the effort-anchored reward ceiling. Optional: absent keeps
   *  the pre-effort behavior byte-identical. */
  effortMinutes?: number;
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
    | "capped_to_sample"
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

  const totalWeight = missions.reduce(
    (s, m) => s + Math.max(1, m.rewardWeight),
    0,
  );
  let adjusted = false;
  let budgetLimited = false;
  let capped = false;

  /** this mission's share of the budget (by weight) — the pot its sample must be paid from. */
  const shareOf = (m: T): bigint =>
    (opts.totalBudgetBase * BigInt(Math.max(1, m.rewardWeight))) /
    BigInt(totalWeight);

  /**
   * The EFFORT-ANCHORED sample target: enough testers that each is paid fairly (share ÷ ceiling),
   * never below the plural-preferred sample, never past the hard cap. Null ceiling (no effort data)
   * → the plain preferred sample, exactly as before.
   */
  const effortTarget = (m: T): number => {
    const ceiling = effortCeilingBase(m.effortMinutes, opts.minRewardBase);
    if (!ceiling) return preferred;
    const byEffort = Number(shareOf(m) / ceiling);
    return Math.max(preferred, Math.min(MAX_SAMPLE, byEffort));
  };

  // THE CAP applies whether or not the request was worded in the plural, because it is not about
  // how many accounts Sage wants — it is about what each tester is paid. A model that asks for ten
  // completions of a qualitative mission on a $1.50 budget drives every reward to the floor (the
  // run that produced 15 × $0.10). Past the fair sample for this pot, another tester buys no extra
  // confidence and only shrinks everyone's share — but "fair sample" now grows with the pot, so a
  // fat budget can never hide behind a tiny sample at inflated pay (2 × $5.00 for 5-minute work).
  const cap = (m: T): T => {
    const capTo = m.qualitative ? effortTarget(m) : Number.MAX_SAFE_INTEGER;
    if (!m.qualitative || m.maxCompletions <= capTo) return m;
    capped = true;
    adjusted = true;
    return { ...m, maxCompletions: capTo };
  };

  /** Raise a qualitative mission UP to the effort-anchored target (overpay protection — applies to
   *  every qualitative mission, plural wording or not: paying $5 for 5 minutes is wrong either way). */
  const raiseToFair = (m: T): T => {
    if (!m.qualitative) return m;
    // NO EFFORT DATA, NO RAISE. The ceiling is the only evidence that a completion is OVERPAID, and
    // without it `effortTarget` just returns the preferred sample — which would silently add testers
    // to every legacy mission, including on a singular goal where this module deliberately never
    // raised. Overpay protection must fire on evidence of overpay, not on its absence.
    if (!effortCeilingBase(m.effortMinutes, opts.minRewardBase)) return m;
    const target = effortTarget(m);
    if (target <= m.maxCompletions) return m;
    adjusted = true;
    return { ...m, maxCompletions: target };
  };

  if (!requestsPluralSample(opts.goal)) {
    const capOnly = missions.map((m) => raiseToFair(cap(m)));
    return {
      missions: capOnly,
      adjusted,
      question: null,
      reason: capped || adjusted ? "capped_to_sample" : "not_plural",
    };
  }

  const out = missions.map((raw) => {
    const m = raiseToFair(cap(raw));
    if (!m.qualitative) return m;
    if (m.maxCompletions >= preferred) return m;
    // this mission's share of the budget, and how many meaningful rewards it can buy.
    const affordable = Number(shareOf(m) / opts.minRewardBase); // whole meaningful rewards this share can fund
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
    reason: budgetLimited
      ? "budget_limited"
      : capped
        ? "capped_to_sample"
        : "raised_to_sample",
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
    const floor = Number(m.maxCompletions);
    // Take the LARGEST sample the pot divides exactly. $1.50 splits three ways; $2.00 does not —
    // and a founder who asked about users should get two testers at $1.00 rather than one at $2.00
    // because of a remainder. Exactness is never traded away: `rewardBase × maxCompletions` still
    // equals the pot bit for bit, so the allocation invariant holds untouched.
    for (let k = target; k > floor; k--) {
      const n = BigInt(k);
      if (pot % n !== BigInt(0)) continue; // never introduce rounding
      const reward = pot / n;
      if (reward < minRewardBase) continue; // never drop a tester below the meaningful floor
      return { ...m, rewardBase: reward, maxCompletions: n };
    }
    return m;
  });
}
