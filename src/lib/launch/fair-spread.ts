import { allocateBudget, MAX_COMPLETIONS, TANGIBLE_PREFERRED_REWARD_BASE, type WeightedMission } from "./budget";
import type { BudgetAllocation } from "./schemas";
import { effortCeilingBase } from "./sample-policy";

/**
 * NO COMPLETION PAYS FAR BEYOND ITS FAIR RATE ON THE CAPPED PATH.
 *
 * Fair capacity sizes a qualitative mission at up to 50 completions × its effort ceiling; the
 * allocator then places that money on the count the MODEL suggested. Measured on the 2 Sep P-GEN
 * run: a 12-minute signup mission sized at $2.40 × 50 landed on 2 completions and paid $76.39
 * each; a 30-minute docs task paid $55.74 × 3 beside a sibling at $5.81. Same pot, wrong number of
 * people. The remedy is the direction fairness points — more testers at the fair rate — and it
 * never touches the allocator: a mission whose reward exceeds `factor` × its fair rate has its
 * suggested count raised to what the pot buys at that rate (capped at MAX_COMPLETIONS), and the
 * exact allocation is re-run. Σ(reward × count) === budget holds because allocateBudget holds it.
 * Off the capped path this is never called, so uncapped plans are byte-identical.
 */
export function spreadOverpaidMissions(
  input: WeightedMission[],
  allocation: BudgetAllocation,
  budgetBase: bigint,
  opts: { minRewardBase: bigint; factor?: number; rounds?: number },
): BudgetAllocation {
  const factor = BigInt(Math.max(1, Math.round(opts.factor ?? 2)));
  const counts = new Map(input.map((m) => [m.missionKey, m.suggestedMaxCompletions]));
  let current = allocation;
  for (let round = 0; round < (opts.rounds ?? 4); round++) {
    if (!current.ok) return current;
    let changed = false;
    for (const a of current.missions) {
      const m = input.find((x) => x.missionKey === a.missionKey);
      if (!m) continue;
      const ceiling = effortCeilingBase(m.effortMinutes, opts.minRewardBase) ?? TANGIBLE_PREFERRED_REWARD_BASE;
      const fair = ceiling > TANGIBLE_PREFERRED_REWARD_BASE ? ceiling : TANGIBLE_PREFERRED_REWARD_BASE;
      if (a.rewardBase <= fair * factor) continue;
      const spend = a.rewardBase * a.maxCompletions;
      const want = Number((spend + fair - BigInt(1)) / fair); // ceil(spend / fair)
      const next = Math.min(Number(MAX_COMPLETIONS), Math.max(Number(a.maxCompletions) + 1, want));
      if (next > (counts.get(a.missionKey) ?? 0)) {
        counts.set(a.missionKey, next);
        changed = true;
      }
    }
    if (!changed) return current;
    const re = allocateBudget(
      input.map((m) => ({ ...m, suggestedMaxCompletions: counts.get(m.missionKey) ?? m.suggestedMaxCompletions })),
      budgetBase,
      { minRewardBase: opts.minRewardBase },
    );
    if (!re.ok) return current;
    current = re;
  }
  return current;
}


/**
 * WHEN THE REMAINDER WILL NOT DIVIDE, RE-EXPRESS THE POT AND RETURN THE RESIDUAL.
 *
 * Measured on plausible.io (P-GEN 45): the sample policy had already raised the signup mission
 * to 48 completions, but the balancer's remainder — 143,127,302 base units — has no divisor at
 * or below 48 except 2, so the allocator's exact-division search (correct, and frozen) could only
 * express it as $71.56 × 2. Raising the count changes nothing; divisibility is the wall.
 *
 * On the CAPPED path the budget being allocated is fair CAPACITY, a derived number, not the
 * founder's money — so the honest move is to pay the mission's pot as n completions at (or just
 * above) its fair rate and hand the sub-cent residual back to the founder: the capped budget
 * shrinks by that residual, Σ(reward × count) equals the new budget exactly, and the plan says
 * it spends a few base units less. Never called off the capped path.
 */
export function spreadOverpaidMissionsExactly(
  input: WeightedMission[],
  allocation: BudgetAllocation,
  budgetBase: bigint,
  opts: { minRewardBase: bigint; factor?: number },
): { allocation: BudgetAllocation; budgetBase: bigint } {
  const current = spreadOverpaidMissions(input, allocation, budgetBase, opts);
  if (!current.ok) return { allocation: current, budgetBase };
  const factor = BigInt(Math.max(1, Math.round(opts.factor ?? 2)));
  let residual = BigInt(0);
  const missions = current.missions.map((a) => {
    const m = input.find((x) => x.missionKey === a.missionKey);
    if (!m) return a;
    const ceiling = effortCeilingBase(m.effortMinutes, opts.minRewardBase) ?? TANGIBLE_PREFERRED_REWARD_BASE;
    const fair = ceiling > TANGIBLE_PREFERRED_REWARD_BASE ? ceiling : TANGIBLE_PREFERRED_REWARD_BASE;
    if (a.rewardBase <= fair * factor) return a;
    const pot = a.rewardBase * a.maxCompletions;
    let n = pot / fair; // floor: as many people as the pot pays at the fair rate
    if (n > MAX_COMPLETIONS) n = MAX_COMPLETIONS;
    if (n <= a.maxCompletions) return a;
    const reward = pot / n; // ≥ fair by construction
    residual += pot - reward * n;
    return { ...a, rewardBase: reward, maxCompletions: n };
  });
  if (residual === BigInt(0) && missions.every((x, i) => x === current.missions[i])) return { allocation: current, budgetBase };
  const next = budgetBase - residual;
  return {
    allocation: { ...current, missions, totalBudgetBase: next, allocatedBase: next },
    budgetBase: next,
  };
}
