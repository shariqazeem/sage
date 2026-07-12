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
    const othersSpend = otherAlloc.reduce((s, m) => s + m.rewardBase * m.maxCompletions, BigInt(0));

    // The balancer takes a single completion whose reward is EXACTLY the remainder.
    const balancerReward = B - othersSpend;
    if (balancerReward >= MIN) {
      const missions: AllocatedMission[] = [
        {
          missionKey: balancer.missionKey,
          rewardBase: balancerReward,
          maxCompletions: BigInt(1),
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
