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
