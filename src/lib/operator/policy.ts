/**
 * THE STANDING MANDATE — how much the agent may commit of a founder's money, and when.
 *
 * A founder funds a treasury once. From then on Sage decides what work to buy. This file is the
 * bound on that autonomy: given the balance, everything already live on the board, and how those
 * campaigns are actually performing, it answers one question — may the agent commit money right
 * now, and how much.
 *
 * Three rules make it safe to hand a model the wheel:
 *
 * 1. **The model never states an amount.** A model may propose WHERE to buy work — which surface,
 *    which kind. Every figure below is computed here, deterministically, from the policy and from
 *    observed results. It is the payout bargain moved one layer up: the brain proposes and the vault
 *    disposes; the allocator proposes and the mandate sizes.
 *
 * 2. **Exposure is the risk, not spend.** Money sitting on the board that nobody has claimed is
 *    money about to be spent on nothing. The mandate caps what may sit unclaimed at once, which is
 *    exactly what lets several small campaigns run side by side instead of one large one. Spending
 *    all of a treasury on one campaign is not a strategy; a probe, then a second probe that
 *    complements it while the first is watched, is.
 *
 * 3. **A surface earns its size.** The first campaign against a product is a probe. A surface whose
 *    work gets claimed earns a larger allocation next time; one that goes quiet earns none, and its
 *    stalled campaign is stopped so the money comes back.
 *
 * Not to be confused with the SETTLEMENT operator (`GOAT_OPERATOR_ADDRESS`), the key that signs
 * payouts. This is the agent acting as operator of a founder's budget.
 *
 * Every amount is USDC base units (6 decimals), the same currency as `rewardAmount` and the budget
 * compiler, so nothing here needs to round.
 */

/** The founder's standing instruction. Every field is a ceiling the agent cannot argue with. */
export interface OperatorPolicy {
  /** Off by default. A treasury with no armed mandate is a wallet, not an operator. */
  enabled: boolean;
  /** Ceiling on everything committed in a rolling seven days. */
  weeklyCapBase: number;
  /** The largest single campaign, whatever the strategy says. */
  perCampaignCapBase: number;
  /** Below this the agent stops committing entirely — the founder's floor, always theirs. */
  reserveFloorBase: number;
  /** The first campaign against an unproven surface. Small on purpose. */
  probeBase: number;
  /** How far a proven surface may scale, as a multiple of the probe. */
  maxScale: number;
  /** How many campaigns may be live at once. */
  maxConcurrent: number;
  /** Share of the treasury allowed to sit on the board unclaimed at once, 0..1. */
  maxExposure: number;
  /** Minimum gap between launches, so a bad hour cannot become a bad day. */
  minSpacingMinutes: number;
  /** A live campaign with no submissions after this long is stalled: stop it, reclaim the money. */
  stallAfterMinutes: number;
  /** Never commit less than this — a campaign too small to pay anyone is worse than none. */
  minCampaignBase: number;
}

export const DEFAULT_POLICY: OperatorPolicy = {
  enabled: false,
  weeklyCapBase: 50_000_000,
  perCampaignCapBase: 15_000_000,
  reserveFloorBase: 0,
  probeBase: 5_000_000,
  maxScale: 3,
  maxConcurrent: 3,
  maxExposure: 0.6,
  minSpacingMinutes: 90,
  stallAfterMinutes: 2_880,
  minCampaignBase: 1_000_000,
};

/** One campaign as the mandate sees it: what it cost, what it bought, and whether anyone came. */
export interface CampaignObservation {
  campaignId: string;
  /** The position this campaign is a bet on — the product host. Sizing is per surface. */
  surface: string;
  /** What KIND of work it bought. Without this the allocator cannot see that it already ran a
   *  testing run here, and asks for the same thing again — measured by P-OPERATOR at 0 of 3. */
  kind: "testing" | "gig" | "grant";
  budgetBase: number;
  /** Total reward slots across its missions. */
  slots: number;
  /** Slots actually paid. */
  paid: number;
  /** Submissions received, paid or not — the honest sign that anyone showed up. */
  submissions: number;
  ageMinutes: number;
  status: "live" | "ended";
  /** Money committed but not yet claimed: unpaid slots at their reward. */
  unclaimedBase: number;
}

export interface MandateState {
  policy: OperatorPolicy;
  /** Spendable USDC in the treasury right now. */
  balanceBase: number;
  /** Committed in the trailing seven days, launched or not yet claimed. */
  committedThisWeekBase: number;
  /** Minutes since the last launch; null when the agent has never launched. */
  minutesSinceLastLaunch: number | null;
  observations: CampaignObservation[];
}

export type MandateVerdict =
  | { action: "launch"; budgetBase: number; surface: string | null; reason: string }
  | { action: "hold"; reason: string };

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const FILLED = 0.6;

/** Live exposure: money on the board no one has claimed. */
export function exposureBase(obs: CampaignObservation[]): number {
  return sum(obs.filter((o) => o.status === "live").map((o) => Math.max(0, o.unclaimedBase)));
}

/**
 * What a surface has earned. A surface is proven by campaigns that were CLAIMED, not by campaigns
 * that were merely paid for — a filled board is the only evidence that the work reached anyone.
 */
export function surfaceScale(surface: string, obs: CampaignObservation[], policy: OperatorPolicy): { scale: number; why: string } {
  const mine = obs.filter((o) => o.surface === surface);
  if (mine.length === 0) return { scale: 1, why: "first campaign on this surface — a probe" };
  const ended = mine.filter((o) => o.status === "ended" || o.slots > 0);
  const proven = ended.filter((o) => o.slots > 0 && o.paid / o.slots >= FILLED).length;
  const quiet = mine.filter((o) => o.submissions === 0 && o.ageMinutes >= policy.stallAfterMinutes).length;
  if (proven === 0 && quiet > 0) return { scale: 0, why: `${quiet} campaign${quiet === 1 ? "" : "s"} here went unclaimed — this surface has not earned another` };
  if (proven === 0) return { scale: 1, why: "nothing has filled here yet — still probing" };
  return { scale: Math.min(policy.maxScale, 1 + proven), why: `${proven} campaign${proven === 1 ? "" : "s"} here filled — scaling ${Math.min(policy.maxScale, 1 + proven)}×` };
}

/**
 * May the agent commit money right now, and how much. Checks run most-protective first, so the
 * reason a founder reads is the binding constraint, not the last one tested.
 */
export function allocate(state: MandateState, surface: string | null): MandateVerdict {
  const p = state.policy;
  if (!p.enabled) return { action: "hold", reason: "the standing mandate is off" };

  const spendable = state.balanceBase - p.reserveFloorBase;
  if (spendable < p.minCampaignBase) {
    return { action: "hold", reason: `the treasury is at its reserve floor — nothing above ${usd(p.reserveFloorBase)} to commit` };
  }

  const weekly = p.weeklyCapBase - state.committedThisWeekBase;
  if (weekly < p.minCampaignBase) {
    return { action: "hold", reason: `this week's ceiling of ${usd(p.weeklyCapBase)} is committed` };
  }

  const live = state.observations.filter((o) => o.status === "live").length;
  if (live >= p.maxConcurrent) {
    return { action: "hold", reason: `${live} campaigns are already running — the mandate allows ${p.maxConcurrent} at once` };
  }

  if (state.minutesSinceLastLaunch !== null && state.minutesSinceLastLaunch < p.minSpacingMinutes) {
    const wait = Math.ceil(p.minSpacingMinutes - state.minutesSinceLastLaunch);
    return { action: "hold", reason: `launched ${Math.floor(state.minutesSinceLastLaunch)} minutes ago — waiting ${wait} more before committing again` };
  }

  const exposed = exposureBase(state.observations);
  const exposureRoom = Math.floor(state.balanceBase * p.maxExposure) - exposed;
  if (exposureRoom < p.minCampaignBase) {
    return { action: "hold", reason: `${usd(exposed)} is already on the board unclaimed — waiting for it to be worked before committing more` };
  }

  const { scale, why } = surface ? surfaceScale(surface, state.observations, p) : { scale: 1, why: "no surface named — probe size" };
  if (scale === 0) return { action: "hold", reason: why };

  const target = p.probeBase * scale;
  const budgetBase = Math.min(target, p.perCampaignCapBase, weekly, spendable, exposureRoom);
  if (budgetBase < p.minCampaignBase) {
    return { action: "hold", reason: `only ${usd(budgetBase)} of headroom — below the ${usd(p.minCampaignBase)} floor for a campaign worth running` };
  }

  const capped = budgetBase < target ? `, capped by ${bindingName(budgetBase, { perCampaign: p.perCampaignCapBase, weekly, spendable, exposureRoom })}` : "";
  return { action: "launch", budgetBase, surface, reason: `${why}${capped}` };
}

function bindingName(chosen: number, caps: { perCampaign: number; weekly: number; spendable: number; exposureRoom: number }): string {
  if (chosen === caps.perCampaign) return "the per-campaign ceiling";
  if (chosen === caps.weekly) return "this week's remaining ceiling";
  if (chosen === caps.exposureRoom) return "how much is already unclaimed on the board";
  if (chosen === caps.spendable) return "the balance above the reserve floor";
  return "the mandate";
}

/** Live campaigns nobody came to. Their money belongs back in the treasury, not on a dead board. */
export function stalled(obs: CampaignObservation[], policy: OperatorPolicy): { campaignId: string; reason: string }[] {
  return obs
    .filter((o) => o.status === "live" && o.submissions === 0 && o.ageMinutes >= policy.stallAfterMinutes)
    .map((o) => ({
      campaignId: o.campaignId,
      reason: `no one submitted in ${Math.floor(o.ageMinutes / 60)} hours — stopping it returns ${usd(o.unclaimedBase)} to the treasury`,
    }));
}

export const usd = (base: number) => `$${(base / 1e6).toFixed(2)}`;
