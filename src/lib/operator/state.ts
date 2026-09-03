import "server-only";
import type { Campaign } from "@/lib/db/schema";
import { listCampaigns, listMissions, listSubmissions } from "@/lib/db/campaigns";
import { founderStorageKey, sameFounder } from "@/lib/auth/founder";
import { listWorkspaceCampaigns, workspaceOwnedBy } from "@/lib/db/workspaces";
import { getWebTreasury } from "@/lib/treasury/web";
import { usdcBalanceBase } from "@/lib/telegram/agent-wallet-tools";
import { committedThisWeekBase, getMandate, lastLaunchAt, policyFrom } from "@/lib/db/operator";
import type { CampaignObservation, MandateState } from "./policy";

/**
 * WHAT THE AGENT CAN SEE about its own positions. Everything here is read from the ledger and the
 * chain — never from a model, and never from a stored summary that could drift from the rows it
 * summarises. The pure mandate in `policy.ts` decides against exactly this.
 */

/** The position a campaign is a bet on: the host of the surface its missions actually target. */
export function surfaceOf(campaign: Campaign, fallback?: string | null): string {
  const target = listMissions(campaign.id).map((m) => m.targetSurface).find((t) => t && t.length > 0);
  for (const candidate of [target, fallback]) {
    if (!candidate) continue;
    try {
      return new URL(candidate.startsWith("http") ? candidate : `https://${candidate}`).host.replace(/^www\./, "");
    } catch {
      /* a surface we cannot parse is not a position we can size */
    }
  }
  return "unknown";
}

export function observe(campaign: Campaign, nowSec: number, fallbackSurface?: string | null): CampaignObservation {
  const missions = listMissions(campaign.id);
  const subs = listSubmissions(campaign.id);
  const paidBy = new Map<string, number>();
  for (const s of subs) if (s.status === "paid") paidBy.set(s.missionIdHash ?? "", (paidBy.get(s.missionIdHash ?? "") ?? 0) + 1);
  let slots = 0;
  let unclaimedBase = 0;
  let paid = 0;
  for (const m of missions) {
    const done = paidBy.get(m.missionIdHash) ?? 0;
    slots += m.maxCompletions;
    paid += Math.min(done, m.maxCompletions);
    unclaimedBase += Math.max(0, m.maxCompletions - done) * m.rewardAmount;
  }
  const status = campaign.status === "live" ? "live" : "ended";
  return {
    campaignId: campaign.id,
    surface: surfaceOf(campaign, fallbackSurface),
    kind: campaign.kind === "gig" || campaign.kind === "grant" ? campaign.kind : "testing",
    budgetBase: slots > 0 ? slots * campaign.rewardAmount : campaign.rewardAmount,
    slots,
    paid,
    submissions: subs.length,
    ageMinutes: Math.max(0, Math.floor((nowSec - (campaign.createdAt ?? nowSec)) / 60)),
    status,
    unclaimedBase: status === "live" ? unclaimedBase : 0,
  };
}

/** Every campaign this founder is responsible for, whichever door launched it. */
export function founderCampaigns(founderAddress: string): Campaign[] {
  const byId = new Map<string, Campaign>();
  const ws = workspaceOwnedBy(founderStorageKey(founderAddress));
  for (const c of ws ? listWorkspaceCampaigns(ws) : []) byId.set(c.id, c);
  for (const c of listCampaigns()) if (sameFounder(c.posterWallet, founderAddress)) byId.set(c.id, c);
  return [...byId.values()].filter((c) => !c.sandbox);
}

/**
 * The full picture the mandate decides against: the policy, the real USDC balance of the treasury,
 * what is already committed this week, and how every live campaign is actually doing. Returns null
 * when the founder has no mandate row at all — there is nothing to decide.
 */
export async function mandateStateFor(founderAddress: string, nowSec = Math.floor(Date.now() / 1000)): Promise<(MandateState & { treasuryAddress: string | null; productUrl: string | null; goal: string | null }) | null> {
  const mandate = getMandate(founderAddress);
  if (!mandate) return null;
  const treasury = getWebTreasury(founderAddress);
  let balanceBase = 0;
  if (treasury) {
    try {
      balanceBase = Number(await usdcBalanceBase(treasury.privyWalletAddress));
    } catch {
      balanceBase = 0; // an unreadable balance is treated as no money: the mandate holds, never spends
    }
  }
  const last = lastLaunchAt(founderAddress);
  return {
    policy: policyFrom(mandate),
    balanceBase,
    committedThisWeekBase: committedThisWeekBase(founderAddress, nowSec),
    minutesSinceLastLaunch: last === null ? null : Math.max(0, Math.floor((nowSec - last) / 60)),
    observations: founderCampaigns(founderAddress).map((c) => observe(c, nowSec, mandate.productUrl)),
    treasuryAddress: treasury?.privyWalletAddress ?? null,
    productUrl: mandate.productUrl,
    goal: mandate.goal,
  };
}
