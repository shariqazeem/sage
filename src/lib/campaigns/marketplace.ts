import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, missions, submissions, type Campaign, type SettlementRail } from "@/lib/db/schema";
import { isTestnetChain, tokenSymbol } from "@/lib/format";
import { OBS_BAR } from "@/lib/deputy/observation-verify";
import { settledLedger } from "./settled-ledger";

/**
 * THE PUBLIC MARKETPLACE — every mission anyone can actually get paid for, right now.
 *
 * Sage already had two ways in: a founder's own dashboard, and a direct link to one campaign's
 * tester board. Nothing listed the open work across campaigns, so a tester could only find a
 * mission if a founder handed them the URL. This is the missing side of the market: founders get
 * testers they never had to recruit, and testers get a list of paid work.
 *
 * WHAT IS SHOWN IS DELIBERATELY NARROW. A row appears only when someone can genuinely be paid for
 * it — a live campaign, a non-closed mission, and a slot that is not already taken. Listing work
 * that cannot pay is the same class of untruth as a stopped campaign showing "verifying" forever.
 *
 * ONE QUERY PER TABLE, not per campaign. `v2Economics` calls `countPaidForMission` once per mission,
 * which is fine for a single board but is N x (1+M) round trips across a marketplace. Here the paid
 * counts arrive as one grouped read and are joined in memory.
 */

export interface MarketplaceMission {
  missionKey: string;
  missionIdHash: string;
  title: string;
  objective: string;
  targetSurface: string;
  criteria: string[];
  evidenceList: string[];
  rewardBase: number;
  rewardUsd: number;
  maxCompletions: number;
  paid: number;
  remainingSlots: number;
  /** "url-verifiable" missions can auto-pay; "observation-based" ones are founder-approved. */
  verifiabilityClass: "url-verifiable" | "observation-based";
}

export interface MarketplaceCampaign {
  id: string;
  title: string;
  /** where a tester goes to read the full brief and submit. */
  boardPath: string;
  chainId: number;
  /**
   * WHICH RAIL PAYS — not the chain id. A tester holds one wallet on one rail, and the board is a
   * mix, so this is the difference between "I can do this now" and finding out at the submit button.
   */
  settlementRail: SettlementRail;
  tokenSymbol: string;
  isTestnet: boolean;
  /** true when the founder's mandate can pay without a human in the loop. */
  autopays: boolean;
  openMissions: number;
  openSlots: number;
  /** the largest single reward on offer here, for sorting and for the card headline. */
  topRewardUsd: number;
  totalOpenUsd: number;
  missions: MarketplaceMission[];
}

/**
 * One row of the marketplace as a TESTER reads it: a single mission, carrying enough of its
 * campaign to be judged and opened on its own. People pick a task, not a campaign — a campaign-first
 * list makes someone open three boards to compare two rewards.
 */
export interface MarketplaceRow {
  key: string;
  campaignId: string;
  campaignTitle: string;
  boardPath: string;
  title: string;
  objective: string;
  targetSurface: string;
  /** the product's hostname — what a tester actually recognises. */
  productHost: string | null;
  criteria: string[];
  evidenceList: string[];
  rewardUsd: number;
  remainingSlots: number;
  maxCompletions: number;
  tokenSymbol: string;
  isTestnet: boolean;
  settlementRail: SettlementRail;
  autopays: boolean;
  /** roughly how involved the work is, derived from what the mission asks for — never a promise. */
  effort: "quick" | "standard" | "deep";
}

/**
 * A payout that ALREADY HAPPENED — the marketplace's only honest form of social proof.
 *
 * Superteam-style boards lead with "total value earned" because a stranger's first question is
 * whether anyone actually gets paid. Ours can answer it with transactions rather than a number we
 * typed: every row here is a settled submission with a hash anyone can check on the explorer.
 */
export interface MarketplacePayout {
  wallet: string;
  usd: number;
  txHash: string;
  /** the product the work was done on, for recognisability. */
  productHost: string | null;
  at: number;
}

export interface MarketplaceView {
  campaigns: MarketplaceCampaign[];
  /** every open mission, flattened and sorted by reward — the tester-facing list. */
  rows: MarketplaceRow[];
  /** most recent settled payouts, newest first. Verifiable, never a claim. */
  recentPayouts: MarketplacePayout[];
  /** what Sage has ACTUALLY paid out, all time — the number a stranger wants before starting. */
  paidToDate: { usd: number; count: number };
  totals: { campaigns: number; missions: number; slots: number; usd: number };
}

/** A rough size for the work, from what the mission itself demands. Presentation only — it never
 *  touches money, and it is deliberately coarse so it cannot read as a time guarantee. */
function effortOf(m: MarketplaceMission): MarketplaceRow["effort"] {
  const asks = m.criteria.length + m.evidenceList.length;
  if (asks <= 3) return "quick";
  return asks <= 6 ? "standard" : "deep";
}

/** Hostname of the surface a tester will actually visit; null when it is not a usable URL. */
function hostOf(surface: string): string | null {
  try {
    return new URL(surface).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const toUsd = (base: number) => base / 1_000_000;

/** Paid completions for MANY missions in one grouped read. Missing key = zero paid. */
function paidCountsByMission(missionIdHashes: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (missionIdHashes.length === 0) return out;
  const rows = db
    .select({ missionIdHash: submissions.missionIdHash })
    .from(submissions)
    .where(
      and(eq(submissions.status, "paid"), inArray(submissions.missionIdHash, missionIdHashes)),
    )
    .all();
  for (const r of rows) {
    if (!r.missionIdHash) continue;
    out.set(r.missionIdHash, (out.get(r.missionIdHash) ?? 0) + 1);
  }
  return out;
}

/**
 * What has actually been paid — read from THE SETTLED LEDGER, the same rows the explorer sums.
 *
 * This used to price paid submissions by a mission-reward lookup with no chain filter, which is
 * how the marketplace, the launch page and the explorer showed three different totals on the
 * same day (2026-09-01). Now: one deduped settlement event per row, mainnet only (a testnet
 * payout moves no real money, so it has no place in this headline), operator dogfood excluded —
 * the panel is titled "paid to real testers" and Sage paying itself is not that. The product
 * host still comes from the mission that was paid; a row that cannot name one simply shows
 * without a host rather than being dropped: the settlement is real either way.
 */
function settledSoFar(): { recentPayouts: MarketplacePayout[]; paidToDate: { usd: number; count: number } } {
  const ledger = settledLedger().filter((r) => r.mainnet && !r.operator && r.amountBase > 0);
  if (ledger.length === 0) return { recentPayouts: [], paidToDate: { usd: 0, count: 0 } };

  const subIds = ledger.map((r) => r.submissionId).filter((x): x is string => !!x);
  const hashBySub = new Map(
    subIds.length === 0
      ? []
      : db
          .select({ id: submissions.id, missionIdHash: submissions.missionIdHash })
          .from(submissions)
          .where(inArray(submissions.id, subIds))
          .all()
          .map((s2) => [s2.id, s2.missionIdHash]),
  );
  const hashes = [...new Set([...hashBySub.values()].filter((h): h is string => !!h))];
  const surfaceByHash = new Map(
    hashes.length === 0
      ? []
      : db
          .select({ h: missions.missionIdHash, surface: missions.targetSurface })
          .from(missions)
          .where(inArray(missions.missionIdHash, hashes))
          .all()
          .map((m) => [m.h, m.surface]),
  );

  const payouts: MarketplacePayout[] = ledger.map((r) => {
    const h = r.submissionId ? hashBySub.get(r.submissionId) : null;
    const surface = h ? surfaceByHash.get(h) : null;
    return {
      wallet: r.wallet ?? "",
      usd: r.amountBase / 1_000_000,
      txHash: r.txHash,
      productHost: surface ? hostOf(surface) : null,
      at: r.at,
    };
  });
  return {
    recentPayouts: payouts.slice(0, 8),
    paidToDate: { usd: payouts.reduce((sum, p) => sum + p.usd, 0), count: payouts.length },
  };
}

/**
 * Every campaign with at least one mission a tester can still be paid for.
 *
 * Excluded, each for its own reason:
 *  - status !== "live"     — a draft has no vault, and a stopped one has a revoked vault;
 *  - sandbox               — the red-team box can never settle, by construction;
 *  - mission status closed — the founder retired it;
 *  - remainingSlots === 0  — every completion is already paid, so a submission would be wasted work.
 */
export function marketplace(): MarketplaceView {
  const live: Campaign[] = db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.status, "live"), eq(campaigns.sandbox, false)))
    .all();
  if (live.length === 0) {
    return {
      campaigns: [],
      rows: [],
      ...settledSoFar(),
      totals: { campaigns: 0, missions: 0, slots: 0, usd: 0 },
    };
  }

  // WORK PROOF — an ALLOWLISTED campaign pays a named recipient list only. Listing it publicly
  // would invite strangers to do real work the submit route must then refuse (403) — the exact
  // "wasted work" failure this board exists to prevent. Same payability rule as a filled slot:
  // if YOU can't be paid for it, it isn't advertised to you.
  const open = live.filter((c) => !(Array.isArray(c.allowlist) && c.allowlist.length > 0));
  const ids = open.map((c) => c.id);
  const missionRows = ids.length
    ? db.select().from(missions).where(inArray(missions.campaignId, ids)).all()
    : [];
  const paidBy = paidCountsByMission(missionRows.map((m) => m.missionIdHash));
  /** Distinct observations pinned to each campaign — what an observation account is judged against. */
  const corpusSources = new Map(live.map((c) => [c.id, c.privateCorpusSources ?? 0]));

  const byCampaign = new Map<string, MarketplaceMission[]>();
  for (const m of missionRows) {
    if (m.status === "closed") continue;
    const paid = paidBy.get(m.missionIdHash) ?? 0;
    const remainingSlots = Math.max(0, m.maxCompletions - paid);
    if (remainingSlots === 0) continue; // full — nobody else can be paid for it
    // OBSERVATION WORK WITH NOTHING TO JUDGE IT AGAINST CANNOT BE PAID, so it must not be advertised
    // as paid work. `observationBar` hard-fails `thin_corpus` below OBS_BAR.minKeySources, which
    // means every submission against such a mission is held — not occasionally, always.
    //
    // MEASURED live: launch-kyvernlabs-com-63rjdf sat on this board with THREE observation missions,
    // eleven open slots and a corpus of zero. A stranger arriving from a founder DM would have done
    // real work and waited forever, which is the single worst thing this product can do to someone.
    // The url-verifiable lane is unaffected: it is judged by fetching the page the tester supplies,
    // so it needs no corpus and stays listed.
    //
    // Same payability rule as a revoked vault, a filled slot, or a testnet campaign below.
    if (
      m.verifiabilityClass === "observation-based" &&
      (corpusSources.get(m.campaignId) ?? 0) < OBS_BAR.minKeySources
    ) {
      continue;
    }
    const list = byCampaign.get(m.campaignId) ?? [];
    list.push({
      missionKey: m.missionKey,
      missionIdHash: m.missionIdHash,
      title: m.title,
      objective: m.objective,
      targetSurface: m.targetSurface,
      criteria: m.criteria,
      evidenceList: m.evidenceList,
      rewardBase: m.rewardAmount,
      rewardUsd: toUsd(m.rewardAmount),
      maxCompletions: m.maxCompletions,
      paid,
      remainingSlots,
      verifiabilityClass: m.verifiabilityClass,
    });
    byCampaign.set(m.campaignId, list);
  }

  const out: MarketplaceCampaign[] = [];
  for (const c of live) {
    const ms = byCampaign.get(c.id);
    if (!ms || ms.length === 0) continue;
    // TESTNET WORK IS NOT PAID WORK. A test-token campaign cannot pay anyone real money, so listing
    // it on a board whose whole promise is "get paid" asks a stranger to do a task for nothing and
    // find out afterwards. Same payability rule as a revoked vault or a filled slot.
    if (isTestnetChain(c.chainId ?? 59902)) continue;
    ms.sort((a, b) => b.rewardUsd - a.rewardUsd);
    const chainId = c.chainId ?? 59902;
    const openSlots = ms.reduce((s, m) => s + m.remainingSlots, 0);
    out.push({
      id: c.id,
      title: c.title,
      boardPath: `/c/${c.id}`,
      chainId,
      settlementRail: c.settlementRail,
      tokenSymbol: tokenSymbol(chainId),
      isTestnet: isTestnetChain(chainId),
      autopays: c.autonomy === "autopilot",
      openMissions: ms.length,
      openSlots,
      topRewardUsd: ms[0]!.rewardUsd,
      totalOpenUsd: ms.reduce((s, m) => s + m.rewardUsd * m.remainingSlots, 0),
      missions: ms,
    });
  }

  // Real money first: the biggest single reward a tester could earn, then the most work available.
  out.sort((a, b) => b.topRewardUsd - a.topRewardUsd || b.openSlots - a.openSlots);

  const rows: MarketplaceRow[] = out.flatMap((c) =>
    c.missions.map((m) => ({
      key: `${c.id}:${m.missionKey}`,
      campaignId: c.id,
      campaignTitle: c.title,
      boardPath: c.boardPath,
      title: m.title,
      objective: m.objective,
      targetSurface: m.targetSurface,
      productHost: hostOf(m.targetSurface),
      criteria: m.criteria,
      evidenceList: m.evidenceList,
      rewardUsd: m.rewardUsd,
      remainingSlots: m.remainingSlots,
      maxCompletions: m.maxCompletions,
      tokenSymbol: c.tokenSymbol,
      isTestnet: c.isTestnet,
      settlementRail: c.settlementRail,
      autopays: c.autopays,
      effort: effortOf(m),
    })),
  );
  rows.sort((a, b) => b.rewardUsd - a.rewardUsd || b.remainingSlots - a.remainingSlots);

  return {
    campaigns: out,
    rows,
    ...settledSoFar(),
    totals: {
      campaigns: out.length,
      missions: out.reduce((s, c) => s + c.openMissions, 0),
      slots: out.reduce((s, c) => s + c.openSlots, 0),
      usd: out.reduce((s, c) => s + c.totalOpenUsd, 0),
    },
  };
}
