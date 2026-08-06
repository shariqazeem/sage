/**
 * The exact budget compiler. A founder enters ONE total budget; the mission brain
 * proposes effort/priority weights; this deterministic code turns those weights into
 * exact per-completion rewards and completion caps in TOKEN BASE UNITS (no floating
 * point money). The load-bearing invariant, enforced and fuzz-tested:
 *
 *     Σ(rewardBase × maxCompletions) === totalBudgetBase
 *
 * Exactness is structural: one "balancer" mission (the highest-priority one) is given
 * a single completion whose reward absorbs the exact remainder, so the sum can never
 * drift by a base unit. Higher weight ⇒ higher per-completion reward; every reward is
 * ≥ a minimum meaningful floor (no zero/dust rewards); if the budget cannot fund a
 * meaningful plan the compiler reduces scope deterministically or asks for more budget
 * — it NEVER fabricates a plan that exceeds the budget or silently leaves funds idle.
 */

import type { AllocatedMission, BudgetAllocation, MissionPriority } from "./schemas";

/** The minimum meaningful reward per completion (base units) — $0.10 at 6dp. */
export const MIN_REWARD_BASE = BigInt(100_000);
/** A sane per-mission completion cap so one mission can't swallow the plan. */
export const MAX_COMPLETIONS = BigInt(50);

export interface WeightedMission {
  missionKey: string;
  /** 1..10 relative reward weight. */
  weight: number;
  /** suggested paid completions (compiler may reduce to fit the budget). */
  suggestedMaxCompletions: number;
  priority: MissionPriority;
  effortMinutes: number;
}

const PRIORITY_RANK: Record<MissionPriority, number> = { high: 0, medium: 1, low: 2 };

/** Deterministic order: priority, then weight desc, then key — total + stable. */
function ordered(missions: WeightedMission[]): WeightedMission[] {
  return [...missions].sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      b.weight - a.weight ||
      (a.missionKey < b.missionKey ? -1 : a.missionKey > b.missionKey ? 1 : 0),
  );
}

const clampCap = (n: number): bigint => {
  const c = Math.max(1, Math.min(Number(MAX_COMPLETIONS), Math.floor(Number.isFinite(n) ? n : 1)));
  return BigInt(c);
};
const clampWeight = (n: number): number =>
  Math.max(1, Math.min(10, Math.round(Number.isFinite(n) ? n : 1)));

/**
 * Allocate `totalBudgetBase` across the weighted missions exactly. `minRewardBase`
 * defaults to {@link MIN_REWARD_BASE}. Returns `ok:false` with a reason (and the
 * partial idea) when the budget cannot fund even one meaningful mission.
 */
export function allocateBudget(
  input: WeightedMission[],
  totalBudgetBase: bigint,
  opts: { minRewardBase?: bigint } = {},
): BudgetAllocation {
  const MIN = opts.minRewardBase ?? MIN_REWARD_BASE;
  const B = totalBudgetBase;
  const empty: BudgetAllocation = {
    ok: false,
    reason: null,
    missions: [],
    totalBudgetBase: B,
    allocatedBase: BigInt(0),
  };

  if (input.length === 0) return { ...empty, reason: "no missions to fund" };
  if (B < MIN) {
    return {
      ...empty,
      reason: `budget too small — a meaningful plan needs at least ${MIN.toString()} base units (one mission at the minimum reward)`,
    };
  }

  // Work from the full ordered set, dropping the lowest-priority mission each retry
  // until the highest-priority "balancer" can absorb the exact remainder at ≥ MIN.
  let pool = ordered(input);
  while (pool.length > 0) {
    const balancer = pool[0];
    const others = pool.slice(1);

    // Per-completion reward ∝ weight. `u` is the base-unit value of one weight-unit of
    // one completion, spread across the WHOLE working set's weighted completions.
    const weightedCompletions = pool.reduce(
      (s, m) => s + BigInt(clampWeight(m.weight)) * clampCap(m.suggestedMaxCompletions),
      BigInt(0),
    );
    const u = weightedCompletions > BigInt(0) ? B / weightedCompletions : BigInt(0);

    const otherAlloc: AllocatedMission[] = others.map((m) => {
      const cap = clampCap(m.suggestedMaxCompletions);
      const w = clampWeight(m.weight);
      const reward = maxBig(MIN, u * BigInt(w));
      return { missionKey: m.missionKey, rewardBase: reward, maxCompletions: cap, weight: w, effortMinutes: m.effortMinutes };
    });
    let othersSpend = otherAlloc.reduce((s, m) => s + m.rewardBase * m.maxCompletions, BigInt(0));

    // THE SHARE RULE — the mission the founder actually asked about must not be the one that gets
    // the leftovers.
    //
    // Rewards already track difficulty: reward ∝ weight, so a hard mission pays more per tester than
    // an easy one. Nothing tracked how the budget SPLITS between missions, because the split is
    // reward × count and the model picks the count. Measured on a real clawup.org run at $120, goal
    // "launch an agent, which needs topping up credits and paying for compute": the model asked for 3
    // testers on that 25-minute paid mission and 17 on a five-minute "check the Terms of Service
    // effective date". The compiler executed both faithfully, so the founder's actual request took
    // $20.80 and quoting a legal date seventeen times took $44.20 — two thirds of the money, for the
    // same fixed string seventeen times over.
    //
    // The balancer is the plan's top mission by construction (priority, then weight), which is to say
    // the one that most serves the stated goal, so the rule is simply: no other single mission may
    // out-spend it. Only COUNTS are trimmed and only downward, so rewards still track difficulty
    // exactly, the balancer keeps absorbing the exact remainder, and the invariant is untouched —
    // every unit trimmed from an other lands on the balancer. Counts bottom out at 1, so this always
    // terminates, and a plan whose breadth genuinely is the point reverses the rule by itself: give
    // the broad mission the higher priority and it becomes the balancer.
    for (;;) {
      const remainder = B - othersSpend;
      let worst = -1;
      let worstSpend = BigInt(0);
      for (let i = 0; i < otherAlloc.length; i++) {
        const spend = otherAlloc[i].rewardBase * otherAlloc[i].maxCompletions;
        if (spend > remainder && spend > worstSpend && otherAlloc[i].maxCompletions > BigInt(1)) {
          worst = i;
          worstSpend = spend;
        }
      }
      if (worst < 0) break;
      otherAlloc[worst].maxCompletions -= BigInt(1);
      othersSpend -= otherAlloc[worst].rewardBase;
    }

    // The balancer absorbs the EXACT remainder. It used to do that in a single completion, which is
    // what guarantees the sum, and is fine at small budgets: a $10 plan pays its balancer $4.29 once.
    // At founder scale it is absurd. Measured on a 3-mission plan (5, 20 and 60-minute tasks), a
    // $50,000 budget paid ONE tester $16,666.67 for the five-minute task while the other two missions
    // correctly funded 50 testers each — and $16,666 for five minutes is sixteen thousand times the
    // overpay ceiling the sample policy exists to enforce.
    //
    // Spreading it fixes that without weakening the invariant, because exactness never depended on
    // the count being 1 — it depended on the reward being the remainder DIVIDED by the count with
    // nothing left over. So take the largest completion count within the mission's own cap that
    // divides the remainder exactly. Searching downward from the cap prefers more testers at a lower
    // reward, which is the direction fairness points; n = 1 always divides, so this can only ever
    // improve on the old behaviour and never fails to find an answer.
    const balancerRemainder = B - othersSpend;
    const balancerCap = clampCap(balancer.suggestedMaxCompletions);
    let balancerCount = BigInt(1);
    for (let n = balancerCap; n >= BigInt(1); n--) {
      if (balancerRemainder % n === BigInt(0) && balancerRemainder / n >= MIN) {
        balancerCount = n;
        break;
      }
    }
    const balancerReward = balancerRemainder / balancerCount;
    if (balancerRemainder >= MIN) {
      const missions: AllocatedMission[] = [
        {
          missionKey: balancer.missionKey,
          rewardBase: balancerReward,
          maxCompletions: balancerCount,
          weight: clampWeight(balancer.weight),
          effortMinutes: balancer.effortMinutes,
        },
        ...otherAlloc,
      ];
      const allocatedBase = missions.reduce((s, m) => s + m.rewardBase * m.maxCompletions, BigInt(0));
      // Structural guarantee — assert the invariant before returning.
      if (allocatedBase !== B) {
        // Should be unreachable; fail closed rather than return an off-by-one plan.
        return { ...empty, reason: "internal allocation error — sum did not equal budget" };
      }
      // Present in the plan's canonical order (priority/weight/key).
      const byOrder = ordered(input).map((m) => missions.find((a) => a.missionKey === m.missionKey)!).filter(Boolean);
      return { ok: true, reason: null, missions: byOrder, totalBudgetBase: B, allocatedBase };
    }

    // The others are too expensive for the balancer to stay ≥ MIN → drop the lowest-
    // priority non-balancer mission and retry with a smaller, cheaper plan.
    pool = [balancer, ...others.slice(0, -1)];
    if (pool.length === 1) {
      // Only the balancer remains: one mission, one completion, reward == budget.
      if (B >= MIN) {
        const m: AllocatedMission = {
          missionKey: balancer.missionKey,
          rewardBase: B,
          maxCompletions: BigInt(1),
          weight: clampWeight(balancer.weight),
          effortMinutes: balancer.effortMinutes,
        };
        return { ok: true, reason: null, missions: [m], totalBudgetBase: B, allocatedBase: B };
      }
      break;
    }
  }

  return {
    ...empty,
    reason: "budget cannot fund a meaningful multi-mission plan — increase the budget or reduce the mission scope",
  };
}

function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
