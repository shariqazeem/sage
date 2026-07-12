/**
 * Plan (de)serialization between the durable JSON snapshot (bigints as strings) and the
 * in-memory MissionPlanV1 (bigints). Pure. The revise/approve paths deserialize a stored
 * revision back into exact bigint economics so the frozen hash + budget functions run.
 */

import type { CompiledMission, MissionPlanV1 } from "./schemas";

export function deserializePlan(json: unknown): MissionPlanV1 {
  const p = json as Record<string, unknown>;
  const missions = ((p.missions as unknown[]) ?? []).map((mm) => {
    const m = mm as Record<string, unknown>;
    return {
      ...m,
      rewardBase: BigInt(String(m.rewardBase ?? "0")),
      maxCompletions: BigInt(String(m.maxCompletions ?? "1")),
    } as unknown as CompiledMission;
  });
  return {
    ...(p as object),
    missions,
    totalBudgetBase: BigInt(String(p.totalBudgetBase ?? "0")),
    allocatedBase: BigInt(String(p.allocatedBase ?? "0")),
  } as MissionPlanV1;
}
