import "server-only";
import { DEFAULT_POLICY, allocate, type MandateState } from "./policy";
import { choosePosition, proposalLine, type DecisionInput, type Position } from "./decide";
import { founderCampaigns, mandateStateFor, observe } from "./state";
import { allowedSurfaces } from "./tick";
import { getMandate } from "@/lib/db/operator";

/**
 * THE MOVE SAGE WOULD MAKE — shown before a single dollar is in.
 *
 * `/workspace/autopilot` rendered nothing for an unfunded founder: the flagship "agent decides"
 * feature was invisible to every new founder and to every judge, because the mandate only speaks
 * once a treasury is armed and above its floor. That is why it felt like a form. A rehearsal runs
 * the SAME decision — the same closed surface set, the same policy ceilings, the same model choosing
 * WHERE and the same pure arithmetic sizing HOW MUCH — against a treasury that is imagined at
 * exactly one probe above the floor, and records nothing. The line a founder reads is the line the
 * agent would propose; the only difference is that no ring counts down and nothing can commit.
 *
 * Honest by construction: `assumesFundingBase` says what was imagined, `recorded: false` is a type,
 * and `recordIntent` is never imported here.
 */
export interface Rehearsal {
  recorded: false;
  surface: string;
  kind: Position["kind"];
  goal: string;
  reason: string;
  budgetBase: number;
  decidedBy: Position["decidedBy"];
  line: string;
  /** the treasury balance the sizing assumed — the founder's floor plus one full campaign. */
  assumesFundingBase: number;
  /** why there is no move even in rehearsal, when there is none. */
  because: string | null;
}

export interface RehearsalDeps {
  choose?: (input: DecisionInput) => Promise<Position | null>;
  nowSec?: number;
}

const cache = new Map<string, { at: number; value: Rehearsal | null }>();
const TTL_SEC = 600;

export async function rehearse(founderAddress: string, deps: RehearsalDeps = {}): Promise<Rehearsal | null> {
  const nowSec = deps.nowSec ?? Math.floor(Date.now() / 1000);
  const key = founderAddress.toLowerCase();
  const hit = cache.get(key);
  if (hit && nowSec - hit.at < TTL_SEC && !deps.choose) return hit.value;

  const mandate = getMandate(founderAddress);
  const real = await mandateStateFor(founderAddress, nowSec);
  const policy = { ...(real?.policy ?? DEFAULT_POLICY), enabled: true };
  const observations = real?.observations ?? founderCampaigns(founderAddress).map((c) => observe(c, nowSec, mandate?.productUrl ?? null));
  const productUrl = mandate?.productUrl ?? null;
  const surfaces = allowedSurfaces(productUrl, observations);
  const none = (because: string): Rehearsal => ({
    recorded: false, surface: "", kind: "testing", goal: "", reason: "", budgetBase: 0, decidedBy: "rules", line: "",
    assumesFundingBase: policy.reserveFloorBase + policy.perCampaignCapBase, because,
  });
  if (surfaces.length === 0) {
    const r = none("name your product and Sage will show its first move");
    cache.set(key, { at: nowSec, value: r });
    return r;
  }

  // A treasury imagined at the floor plus one full campaign — what a founder would actually fund —
  // so the rules that bind are the ones about the WORK (surface, concurrency, exposure against a
  // real board), not the money not being there. The assumption is printed with the move.
  const imagined: MandateState = {
    policy,
    balanceBase: policy.reserveFloorBase + policy.perCampaignCapBase,
    committedThisWeekBase: real?.committedThisWeekBase ?? 0,
    minutesSinceLastLaunch: null,
    observations,
  };
  const first = allocate(imagined, surfaces[0] ?? null);
  if (first.action === "hold") {
    const r = none(first.reason);
    cache.set(key, { at: nowSec, value: r });
    return r;
  }
  const choose = deps.choose ?? choosePosition;
  const position = await choose({
    productUrl,
    founderGoal: mandate?.goal ?? null,
    founderInstruction: mandate?.instruction ?? null,
    allowedSurfaces: surfaces,
    observations,
    policy,
    budgetBase: first.budgetBase,
  });
  if (!position) {
    const r = none("no surface has earned another campaign yet");
    cache.set(key, { at: nowSec, value: r });
    return r;
  }
  const priced = allocate(imagined, position.surface);
  if (priced.action === "hold") {
    const r = none(priced.reason);
    cache.set(key, { at: nowSec, value: r });
    return r;
  }
  const r: Rehearsal = {
    recorded: false,
    surface: position.surface,
    kind: position.kind,
    goal: position.goal,
    reason: position.reason,
    budgetBase: priced.budgetBase,
    decidedBy: position.decidedBy,
    line: proposalLine(position, priced.budgetBase),
    assumesFundingBase: imagined.balanceBase,
    because: null,
  };
  cache.set(key, { at: nowSec, value: r });
  return r;
}

/** Test seam. */
export function __clearRehearsalCache(): void {
  cache.clear();
}
