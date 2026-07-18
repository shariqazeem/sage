import "server-only";

/**
 * Canonical V2 campaign economics for public display. A campaign_v2 campaign's money truth
 * is the SUM of its locked missions (reward × cap) — funded, paid, and remaining — never
 * the single V1 `rewardAmount`/`maxRecipients` fields (which are meaningless for a
 * multi-mission plan and produce the "$0 of $0" bug). Paid counts come from the real
 * settled submissions per mission. Pure DB read; the vault balance is a best-effort add.
 */

import { listMissions, countPaidForMission } from "@/lib/db/campaigns";
import { isTestnetChain, tokenSymbol as tokenSym } from "@/lib/format";
import type { Campaign } from "@/lib/db/schema";

export interface V2MissionView {
  missionKey: string;
  missionIdHash: string;
  specDigest: string | null;
  title: string;
  objective: string;
  instructions: string;
  targetSurface: string;
  criteria: string[];
  evidenceList: string[];
  rewardBase: number;
  maxCompletions: number;
  paid: number;
  remainingSlots: number;
  status: string;
  /** P16 money gate — "observation-based" missions are founder-approved (never auto-paid). */
  verifiabilityClass: "url-verifiable" | "observation-based";
  /** true once every completion slot is paid (the mission is full). */
  full: boolean;
}

export interface V2Economics {
  isV2: boolean;
  chainId: number;
  tokenSymbol: string;
  isTestnet: boolean;
  vaultAddress: string;
  status: string;
  totalFundedBase: number;
  paidBase: number;
  remainingBase: number;
  missionCount: number;
  totalCompletions: number;
  paidCompletions: number;
  missions: V2MissionView[];
}

/** Compute the real V2 economics for a campaign_v2 campaign from its locked missions. */
export function v2Economics(campaign: Campaign): V2Economics {
  const chainId = campaign.chainId ?? 59902;
  const rows = listMissions(campaign.id).filter((m) => m.status !== "closed");
  const missions: V2MissionView[] = rows.map((m) => {
    const paid = countPaidForMission(m.missionIdHash);
    const remainingSlots = Math.max(0, m.maxCompletions - paid);
    return {
      missionKey: m.missionKey,
      missionIdHash: m.missionIdHash,
      specDigest: m.specDigest ?? null,
      title: m.title,
      objective: m.objective,
      instructions: m.instructions,
      targetSurface: m.targetSurface,
      criteria: m.criteria,
      evidenceList: m.evidenceList,
      rewardBase: m.rewardAmount,
      maxCompletions: m.maxCompletions,
      paid,
      remainingSlots,
      status: m.status,
      verifiabilityClass: m.verifiabilityClass,
      full: remainingSlots === 0,
    };
  });

  const totalFundedBase = missions.reduce((s, m) => s + m.rewardBase * m.maxCompletions, 0);
  const paidBase = missions.reduce((s, m) => s + m.rewardBase * m.paid, 0);
  return {
    isV2: campaign.vaultKind === "campaign_v2",
    chainId,
    tokenSymbol: tokenSym(chainId),
    isTestnet: isTestnetChain(chainId),
    vaultAddress: campaign.vaultAddress,
    status: campaign.status,
    totalFundedBase,
    paidBase,
    remainingBase: Math.max(0, totalFundedBase - paidBase),
    missionCount: missions.length,
    totalCompletions: missions.reduce((s, m) => s + m.maxCompletions, 0),
    paidCompletions: missions.reduce((s, m) => s + m.paid, 0),
    missions,
  };
}
