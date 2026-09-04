import type { MissionPriority } from "./schemas";

/**
 * PAY SHOULD TRACK THE WORK, NOT THE HEADLINE.
 *
 * The mission prompt asks for a reward weight proportional to effort and the critic checks it, but
 * nothing deterministic enforced it — so the model's weight was the price. Measured on a real plan:
 * a fifteen-minute core action paid about $7.40 an hour while a five-minute homepage read paid
 * $37.80. That inverts on most products, because a short mission is easy to describe confidently and
 * a long one is not.
 *
 * It is not only unfair, it is now expensive. Under a standing mandate a mission that pays badly per
 * hour does not fill, an unfilled surface is stopped as "nobody came", and the agent defunds a
 * product that was fine — it just mispriced it.
 *
 * So the weight is DERIVED here, from the effort the architect estimated, with a modest tilt for
 * priority so a critical journey still earns a premium over a trivial one of the same length. The
 * model still decides what the work IS and how long it takes; it no longer decides what an hour of
 * a person's time is worth relative to another's.
 *
 * Deliberately caller-side: `allocateBudget` is frozen and already receives `effortMinutes` without
 * using it for pricing. This changes what it is HANDED, never what it does — the exactness invariant
 * (Σ reward × completions = budget) is untouched.
 */
export const PRIORITY_TILT: Record<MissionPriority, number> = { high: 1.25, medium: 1, low: 0.85 };

const MIN_W = 1;
const MAX_W = 10;

export interface EffortInput {
  missionKey: string;
  effortMinutes: number;
  priority: MissionPriority;
  /** the model's own number, used only when effort cannot decide. */
  rewardWeight: number;
}

/**
 * Weights in 1..10 whose ratios track effort×priority. Returns the model's own weights unchanged
 * when effort cannot discriminate — an all-equal or missing estimate is not evidence, and inventing
 * a spread from it would be worse than deferring.
 */
export function effortWeights(missions: EffortInput[]): Map<string, number> {
  const out = new Map<string, number>();
  if (missions.length === 0) return out;

  const scores = missions.map((m) => {
    const minutes = Number.isFinite(m.effortMinutes) && m.effortMinutes > 0 ? m.effortMinutes : 0;
    return minutes * (PRIORITY_TILT[m.priority] ?? 1);
  });
  const max = Math.max(...scores);
  const min = Math.min(...scores.filter((s) => s > 0), max);
  // no usable estimate, or every mission the same size → the model's weights stand
  if (max <= 0 || max === min) {
    for (const m of missions) out.set(m.missionKey, clamp(Math.round(m.rewardWeight)));
    return out;
  }
  for (let i = 0; i < missions.length; i++) {
    const s = scores[i];
    // an unusable estimate on ONE mission falls back to its own weight rather than pricing it at the floor
    out.set(missions[i].missionKey, s > 0 ? clamp(Math.round((s / max) * MAX_W)) : clamp(Math.round(missions[i].rewardWeight)));
  }
  return out;
}

const clamp = (n: number) => Math.max(MIN_W, Math.min(MAX_W, Number.isFinite(n) ? n : MIN_W));

/** The spread between the best- and worst-paid hour in a plan. 1 is perfectly fair; lower is worse. */
export function hourlyFairness(missions: { effortMinutes: number }[], weights: number[]): number {
  const rates = missions
    .map((m, i) => (m.effortMinutes > 0 ? weights[i] / m.effortMinutes : null))
    .filter((r): r is number => r !== null && r > 0);
  if (rates.length < 2) return 1;
  return Math.min(...rates) / Math.max(...rates);
}
