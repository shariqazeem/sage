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
    | "over_funded"
    | "already_sampled";
  /**
   * The most this plan can pay at FAIR rates, in base units, when the budget exceeds it. A plan can
   * only absorb so much honestly: every mission is capped at MAX_SAMPLE testers, and each tester is
   * capped at the effort-derived ceiling, so the plan's honest capacity is the sum of those. Beyond
   * it the surplus does not buy more testing, it simply inflates each reward.
   *
   * Measured on a real run: clawup.org at $401 produced a single 5-minute mission and paid 50
   * testers $8.02 each — eight times the $0.20-per-minute ceiling the policy exists to hold. Nothing
   * was wrong with the arithmetic; there was just more money than work. Null when the budget fits.
   */
  absorbableBase?: bigint | null;
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
/**
 * OVER-FUNDING — more money than this plan can honestly spend.
 *
 * Every mission is bounded by MAX_SAMPLE testers at its own effort-derived ceiling, so a plan has a
 * real capacity. Past it the surplus does not buy more testing, it only inflates each reward.
 * Measured live on clawup.org at $403: three five-minute missions, one of them paying $35.48 a head
 * — thirty-five times the $0.20-per-minute ceiling this module exists to hold.
 *
 * It wraps EVERY return rather than sitting at the bottom of the happy path, because the first
 * version did sit there and the two early returns — a singular goal, an already-sampled plan —
 * walked straight past it. That is how the clawup run produced $35.48 a head and said nothing.
 *
 * Judged only when every mission carries effort data. Without it there is no fair rate to compare
 * against, and guessing one flagged $1.50 across three testers, fifty cents each, as over-funded.
 * An unsubstantiated warning about a founder's money is worse than no warning.
 */
function withOverFunding<T extends SampleMission>(
  result: SamplePolicyResult<T>,
  opts: { totalBudgetBase: bigint; minRewardBase: bigint },
): SamplePolicyResult<T> {
  // Never overwrite a question the policy already had to ask; that one is more specific.
  if (result.question) return result;
  const ms = result.missions.filter((m) => m.qualitative !== false);
  if (ms.length === 0) return result;
  const ceilings = ms.map((m) => effortCeilingBase(m.effortMinutes, opts.minRewardBase));
  if (!ceilings.every((c) => c !== null)) return result;
  const absorbable = ms.reduce(
    (sum, m, i) => sum + ceilings[i]! * BigInt(Math.max(1, m.maxCompletions)),
    BigInt(0),
  );
  if (absorbable <= BigInt(0) || opts.totalBudgetBase <= absorbable) return result;
  return {
    ...result,
    reason: "over_funded",
    absorbableBase: absorbable,
    question: `This budget is larger than the plan can spend at a fair rate — ${ms.length} mission${ms.length === 1 ? "" : "s"} can pay about $${(Number(absorbable) / 1_000_000).toFixed(2)} in total before each reward runs well above the going rate for the effort involved. Do you want more missions covering more of the product, or a smaller budget to start with?`,
  };
}

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

  /** How many CEILING-RATE rewards this mission's pot funds (0 when the pot can't even pay one at
   *  the fair ceiling — a small budget, which the fair-floor plural path then handles by preferring
   *  fewer, better-paid testers or asking). Null without effort data. */
  const byEffortCount = (m: T): number | null => {
    const ceiling = effortCeilingBase(m.effortMinutes, opts.minRewardBase);
    if (!ceiling) return null;
    return Math.min(MAX_SAMPLE, Number(shareOf(m) / ceiling));
  };

  /**
   * The EFFORT-ANCHORED cap: never cap below the preferred sample; above it, the pot-supported
   * ceiling-rate count is the cap. Null effort data → the plain preferred sample, as before.
   */
  const effortTarget = (m: T): number => {
    const byEffort = byEffortCount(m);
    if (byEffort === null) return preferred;
    return Math.max(preferred, byEffort);
  };

  /**
   * The LOWER bound of SATISFYING pay: $0.05 per estimated minute, never below the meaningful floor.
   * A 20-minute mission paying $0.10 is technically "meaningful" and practically insulting — on a
   * public marketplace an unattractive reward just sits unfilled, which serves nobody. Small budgets
   * now prefer FEWER, fairly-paid testers, and ask the founder when even two fair rewards don't fit.
   */
  const FAIR_FLOOR_PER_MINUTE = BigInt(50_000);
  const fairFloorBase = (m: T): bigint => {
    if (!m.effortMinutes || !Number.isFinite(m.effortMinutes) || m.effortMinutes <= 0) {
      return opts.minRewardBase;
    }
    const f = BigInt(Math.round(m.effortMinutes)) * FAIR_FLOOR_PER_MINUTE;
    return f > opts.minRewardBase ? f : opts.minRewardBase;
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
    //
    // AND: raise only toward what the pot GENUINELY FUNDS at the fair ceiling (`byEffortCount`),
    // never toward the preferred sample. A small pot raised to "preferred" split $1.50 into
    // 3 × $0.50 for 20-minute work — the exact unsatisfying reward the fair floor exists to prevent;
    // the plural path below owns that decision (fewer fairly-paid testers, or an honest ask).
    const byEffort = byEffortCount(m);
    if (byEffort === null || byEffort <= m.maxCompletions) return m;
    adjusted = true;
    return { ...m, maxCompletions: byEffort };
  };

  if (!requestsPluralSample(opts.goal)) {
    const capOnly = missions.map((m) => raiseToFair(cap(m)));
    return withOverFunding({
      missions: capOnly,
      adjusted,
      question: null,
      reason: capped || adjusted ? "capped_to_sample" : "not_plural",
    }, opts);
  }

  const out = missions.map((raw) => {
    const m = raiseToFair(cap(raw));
    if (!m.qualitative) return m;
    if (m.maxCompletions >= preferred) return m;
    // this mission's share of the budget, and how many FAIR rewards it can buy (the fair floor is
    // effort-derived when effort data exists — never split a share into rewards nobody would work for).
    const affordable = Number(shareOf(m) / fairFloorBase(m)); // whole fair rewards this share can fund
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
    // quote the binding FAIR floor (effort-derived when known), not the bare meaningful floor.
    const bindingFloor = out
      .filter((m) => m.qualitative)
      .reduce((max, m) => (fairFloorBase(m) > max ? fairFloorBase(m) : max), opts.minRewardBase);
    const perTester = Number(bindingFloor) / 1_000_000;
    return {
      missions: out,
      adjusted,
      question: `You asked about multiple users, but this budget only funds one fair reward (each tester needs at least $${perTester.toFixed(2)} for this mission's effort). Do you want to raise the budget so ${preferred} people can each be paid fairly, or run it with a single tester?`,
      reason: "budget_limited",
    };
  }

  if (!adjusted)
    return withOverFunding(
      { missions: out, adjusted: false, question: null, reason: "already_sampled" },
      opts,
    );
  return withOverFunding(
    {
      missions: out,
      adjusted: true,
      question: null,
      reason: budgetLimited ? "budget_limited" : capped ? "capped_to_sample" : "raised_to_sample",
    },
    opts,
  );
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
