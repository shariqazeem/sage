import type { GoalJourneyV1 } from "./goal-journey";

/**
 * HOW MANY MISSIONS THE FOUNDER'S BUDGET SHOULD BUY — the one planning decision that belongs to the
 * agent rather than to the compiler.
 *
 * Sage compiles the founder's ordered journey into missions whose criteria are derived from what it
 * actually observed. That part must stay deterministic: a criterion nobody can check is a payout
 * nobody can defend. But *where to cut the journey* — is "walk in, find her, talk to her" one job or
 * three? — is a judgement about what is worth paying for, and it should be made by the thing that
 * just spent minutes using the product. Until now it was hardcoded to one.
 *
 * So the model proposes a PARTITION and the compiler still disposes:
 *   · the model returns groups of checkpoints, each with a weight and a tester count;
 *   · this module accepts the proposal only if it is a genuine partition — every checkpoint used
 *     exactly once, groups CONTIGUOUS in journey order (a journey is a dependency chain; a mission
 *     that skips a middle step cannot be performed), and a sane number of them;
 *   · anything else is rejected and the caller falls back to the single whole-journey mission,
 *     which is exactly today's behaviour.
 *
 * The model never writes a criterion, never cites evidence, and never states an amount. It says how
 * the work divides; the compiler and the budget layer do the rest.
 */

/** Ceiling on missions per journey — beyond this a founder is reading a backlog, not a plan. */
export const MAX_MISSIONS = 4;

export interface MissionPartitionGroup {
  /** checkpoint ids, in journey order, forming one mission. */
  checkpointIds: string[];
  /** relative share of the budget (the budget layer converts weights to exact amounts). */
  rewardWeight: number;
  /** how many independent testers this mission wants (the sample policy still bounds it). */
  maxCompletions: number;
}

export interface MissionPartitionV1 {
  groups: MissionPartitionGroup[];
}

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt;
};

/** Read the model's groups tolerantly — shape varies, meaning does not. */
function readGroups(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["groups", "missions", "partition", "segments", "plan"]) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
  }
  return [];
}

/** The ids a group claims, tolerating a bare string or a list. */
function readIds(g: unknown): string[] {
  const o = (g ?? {}) as Record<string, unknown>;
  const raw =
    o.checkpointIds ?? o.checkpoint_ids ?? o.checkpoints ?? o.ids ?? o.steps;
  const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return arr.filter((x): x is string => typeof x === "string" && x.length > 0);
}

/**
 * Validate a proposed partition against the journey's real checkpoint order.
 * Returns null when the proposal is not a usable partition — the caller then keeps one mission.
 */
export function validateMissionPartition(
  raw: unknown,
  orderedCheckpointIds: readonly string[],
): MissionPartitionV1 | null {
  if (orderedCheckpointIds.length === 0) return null;
  const groups = readGroups(raw);
  if (groups.length === 0 || groups.length > MAX_MISSIONS) return null;

  const position = new Map(orderedCheckpointIds.map((id, i) => [id, i]));
  const seen = new Set<string>();
  const out: MissionPartitionGroup[] = [];

  for (const g of groups) {
    const ids = readIds(g);
    if (ids.length === 0) return null;
    // every id must be real, and used exactly once across the whole partition
    for (const id of ids) {
      if (!position.has(id) || seen.has(id)) return null;
      seen.add(id);
    }
    // CONTIGUOUS in journey order: a journey is a dependency chain, so a mission that omits a middle
    // checkpoint asks a tester to skip a step they must have taken to reach the next one.
    const idx = ids.map((id) => position.get(id)!).sort((a, b) => a - b);
    for (let i = 1; i < idx.length; i++) {
      if (idx[i] !== idx[i - 1]! + 1) return null;
    }
    const o = (g ?? {}) as Record<string, unknown>;
    out.push({
      // re-derived from journey order, never trusted from the model's ordering
      checkpointIds: idx.map((i) => orderedCheckpointIds[i]!),
      rewardWeight: clampInt(o.rewardWeight ?? o.weight, 1, 10, 5),
      maxCompletions: clampInt(o.maxCompletions ?? o.testers ?? o.completions, 1, 50, 1),
    });
  }

  // EXHAUSTIVE: no checkpoint may be dropped — the founder asked for all of them.
  if (seen.size !== orderedCheckpointIds.length) return null;

  // present the groups in journey order, whatever order the model listed them in
  out.sort(
    (a, b) =>
      position.get(a.checkpointIds[0]!)! - position.get(b.checkpointIds[0]!)!,
  );
  // and the groups themselves must tile the journey from the start with no gap
  let expected = 0;
  for (const g of out) {
    if (position.get(g.checkpointIds[0]!)! !== expected) return null;
    expected += g.checkpointIds.length;
  }
  return { groups: out };
}

/** The whole journey as a single mission — the fallback, and today's behaviour. */
export function singleMissionPartition(
  orderedCheckpointIds: readonly string[],
): MissionPartitionV1 {
  return {
    groups: [
      {
        checkpointIds: [...orderedCheckpointIds],
        rewardWeight: 5,
        maxCompletions: 1,
      },
    ],
  };
}

export const PARTITION_SYSTEM =
  "You split a product-testing journey into missions. You decide ONLY how the work divides and what each part is worth relative to the others. You never write test criteria, never cite evidence, and never state a money amount. JSON only.";

/**
 * Ask for a partition of THIS journey. The prompt carries only the founder's goal and the ordered
 * requirements — no evidence ids, because the model has no business citing any.
 */
export function buildPartitionUser(journey: GoalJourneyV1): string {
  const rows = journey.checkpoints.map((c, i) => ({
    checkpointId: c.checkpointId,
    order: i + 1,
    requirement: c.requirement,
  }));
  return [
    `FOUNDER GOAL: ${journey.goal}`,
    ``,
    `ORDERED CHECKPOINTS (a dependency chain — each one assumes the ones before it):`,
    JSON.stringify(rows),
    ``,
    `Split these into 1 to ${MAX_MISSIONS} missions that a founder would actually want tested separately.`,
    `Split when the parts fail for different reasons and a founder would want to know which one broke`,
    `(for example: can people get in at all, versus can they do the thing once they are in).`,
    `Keep it as ONE mission when the journey is a single short flow that only makes sense end to end.`,
    ``,
    `Rules: every checkpointId appears in exactly one group; groups are CONTIGUOUS runs of the order`,
    `above; do not reorder, drop or invent a checkpointId.`,
    `rewardWeight (1-10) is what this part is worth relative to the others — weight the part that`,
    `proves the founder's actual outcome highest. maxCompletions is how many independent testers`,
    `should do it.`,
    ``,
    `Return JSON ONLY: {"groups":[{"checkpointIds":["..."],"rewardWeight":5,"maxCompletions":3}]}`,
  ].join("\n");
}
