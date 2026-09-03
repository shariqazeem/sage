import "server-only";
import { getAddress, type Address } from "viem";
import { getCampaign, recordEvent, setCampaignStatus } from "@/lib/db/campaigns";
import { getInspectionJob } from "@/lib/db/inspection";
import { armedMandates, getMandate, launchesInState, policyFrom, recordIntent, updateLaunch } from "@/lib/db/operator";
import { startInspection } from "@/lib/launch/start";
import { runInspectionJob } from "@/lib/launch/job";
import { getWebTreasury } from "@/lib/treasury/web";
import { launchFromTreasury } from "@/lib/treasury/launch";
import { stopCampaignViaPrivy } from "@/lib/privy/stop-campaign";
import { choosePosition } from "./decide";
import { allocate, stalled, usd } from "./policy";
import { mandateStateFor } from "./state";

/**
 * ONE TICK OF THE STANDING MANDATE — the agent's own turn, run by the sweep.
 *
 * Deliberately a stateless gate rather than a running loop, exactly like the payout autopilot: each
 * tick reads the ledger and the chain, advances whatever is ready, and returns. Nothing is held in
 * memory between ticks, so a restart or a deploy costs nothing.
 *
 * Four things happen, most protective first:
 *
 * 1. **Reclaim.** A live campaign nobody came to is stopped and its money returns to the treasury.
 *    Dead boards are the cheapest way to lose a founder's money.
 * 2. **Finish what was started.** A committed proposal whose plan is ready gets deployed.
 * 3. **Commit what has matured.** A proposal past its veto window turns into a real design job. Up
 *    to that moment the founder could stop it, which is the whole point of proposing first.
 * 4. **Propose.** If the mandate allows another position, the agent chooses one and says so, with
 *    its reason, before any money is involved.
 *
 * A founder's failure is isolated: one bad treasury never blocks the others.
 */

export interface OperatorTickSummary {
  founders: number;
  reclaimed: number;
  reclaimedBase: number;
  launched: number;
  committed: number;
  proposed: number;
  held: string[];
}

const PLAN_TIMEOUT_MIN = 60;

export async function runOperatorTick(nowSec = Math.floor(Date.now() / 1000), defer: (fn: () => Promise<void>) => void = (fn) => void fn()): Promise<OperatorTickSummary> {
  const out: OperatorTickSummary = { founders: 0, reclaimed: 0, reclaimedBase: 0, launched: 0, committed: 0, proposed: 0, held: [] };
  for (const m of armedMandates()) {
    try {
      await tickFounder(m.founderAddress, nowSec, out, defer);
      out.founders += 1;
    } catch (e) {
      console.error(`[operator] tick failed for ${m.founderKey.slice(0, 10)}…:`, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

async function tickFounder(founderAddress: string, nowSec: number, out: OperatorTickSummary, defer: (fn: () => Promise<void>) => void): Promise<void> {
  const state = await mandateStateFor(founderAddress, nowSec);
  if (!state) return;
  const policy = state.policy;
  if (!policy.enabled) return;

  // 1 — reclaim dead boards
  const treasury = getWebTreasury(founderAddress);
  for (const dead of stalled(state.observations, policy)) {
    const campaign = getCampaign(dead.campaignId);
    if (!campaign || !treasury || !campaign.vaultAddress) continue;
    let vault: Address;
    try {
      vault = getAddress(campaign.vaultAddress);
    } catch {
      continue; // a Starknet vault is not stopped from this path
    }
    try {
      const res = await stopCampaignViaPrivy(treasury, vault);
      setCampaignStatus(campaign.id, "cancelled");
      recordEvent({ campaignId: campaign.id, kind: "operator_reclaimed", detail: `Sage stopped this campaign — ${dead.reason}` });
      out.reclaimed += 1;
      out.reclaimedBase += Number(res.recoveredBase ?? 0);
    } catch (e) {
      console.error(`[operator] could not stop ${campaign.id}:`, e instanceof Error ? e.message : e);
    }
  }

  // 2 — deploy whatever the agent already committed to and designed
  for (const l of launchesInState(founderAddress, "committed")) {
    if (!l.jobId) {
      updateLaunch(l.id, { state: "abandoned", reason: `${l.reason} · abandoned: no design job was ever started` });
      continue;
    }
    const job = getInspectionJob(l.jobId);
    if (!job) {
      updateLaunch(l.id, { state: "abandoned", reason: `${l.reason} · abandoned: the design job vanished` });
      continue;
    }
    if (job.status === "failed") {
      updateLaunch(l.id, { state: "abandoned", reason: `${l.reason} · abandoned: the design failed, nothing was funded` });
      continue;
    }
    if (job.status !== "ready") {
      if ((nowSec - l.updatedAt) / 60 > PLAN_TIMEOUT_MIN) {
        updateLaunch(l.id, { state: "abandoned", reason: `${l.reason} · abandoned: the design did not finish in an hour` });
      }
      continue;
    }
    const r = await launchFromTreasury(founderAddress, l.jobId);
    if (r.ok) {
      updateLaunch(l.id, { state: "launched", campaignId: r.campaignId });
      recordEvent({ campaignId: r.campaignId, kind: "operator_launched", detail: `Sage launched this itself — ${l.reason}` });
      out.launched += 1;
    } else if (r.reason === "not_ready") {
      // the plan changed under us; let the next tick re-read rather than force it
    } else {
      updateLaunch(l.id, { state: "abandoned", reason: `${l.reason} · abandoned: ${r.message.slice(0, 120)}` });
    }
  }

  // 3 — commit proposals whose veto window has run out
  const open = launchesInState(founderAddress, "proposed");
  for (const l of open) {
    if (l.commitAt > nowSec) continue;
    const started = startInspection({
      productUrl: state.productUrl ?? (l.surface ? `https://${l.surface}` : ""),
      goal: l.goal,
      targetUsers: "people who would actually use this",
      budgetUsd: l.budgetBase / 1e6,
      founder: founderAddress,
      planningRequestId: `prid:operator:${l.id}`,
      surface: "operator",
      actor: founderAddress,
    });
    if (!started.ok) {
      updateLaunch(l.id, { state: "abandoned", reason: `${l.reason} · abandoned: ${started.error.slice(0, 120)}` });
      continue;
    }
    updateLaunch(l.id, { state: "committed", jobId: started.job.id });
    out.committed += 1;
    if (started.created) defer(() => runInspectionJob(started.job.id));
  }

  // 4 — propose the next position, if the mandate allows one
  const stillOpen = launchesInState(founderAddress, "proposed").length + launchesInState(founderAddress, "committed").length;
  if (stillOpen > 0) return;
  const mandate = getMandate(founderAddress);
  if (!mandate) return;
  const surfaces = allowedSurfaces(state.productUrl, state.observations);
  const first = allocate(state, surfaces[0] ?? null);
  if (first.action === "hold") {
    out.held.push(first.reason);
    return;
  }
  const position = await choosePosition({
    productUrl: state.productUrl,
    founderGoal: state.goal,
    allowedSurfaces: surfaces,
    observations: state.observations,
    policy,
    budgetBase: first.budgetBase,
  });
  if (!position) {
    out.held.push("no surface has earned another campaign");
    return;
  }
  // re-price against the surface actually chosen: sizing is per position, never per proposal
  const priced = allocate(state, position.surface);
  if (priced.action === "hold") {
    out.held.push(priced.reason);
    return;
  }
  recordIntent({
    founderAddress,
    surface: position.surface,
    kind: position.kind,
    goal: position.goal,
    decidedBy: position.decidedBy,
    budgetBase: priced.budgetBase,
    reason: `${position.reason} · sized at ${usd(priced.budgetBase)} because ${priced.reason}`,
    commitAt: nowSec + mandate.vetoWindowMinutes * 60,
  }, nowSec);
  out.proposed += 1;
}

/** The closed set a position may be chosen from: the founder's own product, plus where work has run. */
export function allowedSurfaces(productUrl: string | null, observations: { surface: string }[]): string[] {
  const out: string[] = [];
  if (productUrl) {
    try {
      out.push(new URL(productUrl.startsWith("http") ? productUrl : `https://${productUrl}`).host.replace(/^www\./, ""));
    } catch {
      /* a product url we cannot parse contributes no surface */
    }
  }
  for (const o of observations) if (o.surface && o.surface !== "unknown" && !out.includes(o.surface)) out.push(o.surface);
  return out;
}
