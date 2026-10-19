import { PLAN_ORDER, PLANS, type PlanId } from "./catalog";

/**
 * THE LAUNCH CHECK. Pure: the founder's plan and what they already have live decide whether one
 * more job may start. Called at every door that starts a job (the account launch, the wallet claim,
 * the Starknet deploy, Telegram, the operator) BEFORE any money moves, never after: a check that
 * fired once a vault was funded would strand that money.
 */
export interface Usage {
  /** Jobs live right now, on any network. */
  liveJobs: number;
  /** Budget launched in the last 30 days, in USD base units (6 decimals). */
  launchedBase: bigint;
}

export type LaunchCheck =
  | { ok: true }
  | {
      ok: false;
      code: "live_jobs" | "monthly_volume";
      /** Plain words for the founder; names the plan that would let it through. */
      message: string;
      plan: PlanId;
      /** The cheapest plan that would allow it, if any plan would. */
      upgradeTo: PlanId | null;
    };

const BASE_PER_USD = BigInt(1_000_000);

function usdBase(usd: number): bigint {
  return BigInt(Math.round(usd * 100)) * BigInt(10_000);
}

function fmtUsd(base: bigint): string {
  const cents = Number(base / BigInt(10_000));
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function allows(plan: PlanId, usage: Usage, budgetBase: bigint): "ok" | "live_jobs" | "monthly_volume" {
  const spec = PLANS[plan];
  if (usage.liveJobs + 1 > spec.liveJobs) return "live_jobs";
  if (Number.isFinite(spec.monthlyUsd) && usage.launchedBase + budgetBase > usdBase(spec.monthlyUsd)) return "monthly_volume";
  return "ok";
}

export function checkLaunch(plan: PlanId, usage: Usage, budgetBase: bigint): LaunchCheck {
  const verdict = allows(plan, usage, budgetBase);
  if (verdict === "ok") return { ok: true };
  const from = PLAN_ORDER.indexOf(plan);
  const upgradeTo = PLAN_ORDER.slice(from + 1).find((p) => allows(p, usage, budgetBase) === "ok") ?? null;
  const spec = PLANS[plan];
  const offer = upgradeTo ? ` ${PLANS[upgradeTo].name} lifts this.` : "";
  if (verdict === "live_jobs") {
    return {
      ok: false,
      code: "live_jobs",
      plan,
      upgradeTo,
      message: `${spec.name} runs ${spec.liveJobs === 1 ? "one live job" : `${spec.liveJobs} live jobs`} at a time, and you have ${usage.liveJobs} live. End one, or upgrade.${offer}`,
    };
  }
  const room = usdBase(spec.monthlyUsd) - usage.launchedBase;
  return {
    ok: false,
    code: "monthly_volume",
    plan,
    upgradeTo,
    message: `${spec.name} launches up to ${fmtUsd(usdBase(spec.monthlyUsd))} of work in 30 days. This job is ${fmtUsd(budgetBase)} and ${room > BigInt(0) ? `${fmtUsd(room)} is left` : "nothing is left"} this period.${offer}`,
  };
}

/** Room left this period, for the account page and Settings. Null means no ceiling. */
export function roomLeftBase(plan: PlanId, usage: Usage): bigint | null {
  const n = PLANS[plan].monthlyUsd;
  if (!Number.isFinite(n)) return null;
  const left = usdBase(n) - usage.launchedBase;
  return left > BigInt(0) ? left : BigInt(0);
}

export { BASE_PER_USD };
