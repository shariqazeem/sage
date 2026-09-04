import { linkedWalletsOf } from "@/lib/campaigns/wallet-links";
import { verificationKindOf } from "./v2-economics";
import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, missions, submissions, type Campaign, type SettlementRail } from "@/lib/db/schema";
import { isTestnetChain, tokenSymbol } from "@/lib/format";
import { OBS_BAR } from "@/lib/deputy/observation-verify";
import { settledLedger } from "./settled-ledger";
import { isPublicWork } from "./visibility";

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
  /**
   * SECONDS FROM SUBMIT TO SETTLED — the wait this person actually had, not an average of waits.
   * null when the settlement event names no submission (a chain-only row has no submit time to
   * subtract), which is a missing measurement and never a zero.
   */
  waitSeconds: number | null;
}

export interface MarketplaceView {
  campaigns: MarketplaceCampaign[];
  /** every open mission, flattened and sorted by reward — the tester-facing list. */
  rows: MarketplaceRow[];
  /** most recent settled payouts, newest first. Verifiable, never a claim. */
  recentPayouts: MarketplacePayout[];
  /** what Sage has ACTUALLY paid out, all time — the number a stranger wants before starting. */
  paidToDate: { usd: number; count: number; people: number };
  /**
   * HOW LONG PEOPLE WAITED. Median over every mainnet tester payout whose submit time is known —
   * median, not mean, because one held submission that sat overnight would otherwise describe a
   * wait nobody had. null when nothing measurable has settled yet.
   */
  speed: {
    medianSeconds: number | null;
    measured: number;
    /**
     * One entry per MEASURED payout — not per person. The showcase collapses linked wallets
     * because "how many different people" is the claim the links bear on; a wait is a property of
     * one settlement and collapsing them would drop real measurements from a distribution.
     */
    dots: { txHash: string; seconds: number; usd: number }[];
  };
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
function settledSoFar(): Pick<MarketplaceView, "recentPayouts" | "paidToDate" | "speed"> {
  const ledger = settledLedger().filter((r) => r.mainnet && !r.operator && r.amountBase > 0);
  const nothing = {
    recentPayouts: [],
    paidToDate: { usd: 0, count: 0, people: 0 },
    speed: { medianSeconds: null, measured: 0, dots: [] },
  };
  if (ledger.length === 0) return nothing;

  const subIds = ledger.map((r) => r.submissionId).filter((x): x is string => !!x);
  const subRows =
    subIds.length === 0
      ? []
      : db
          .select({ id: submissions.id, missionIdHash: submissions.missionIdHash, createdAt: submissions.createdAt })
          .from(submissions)
          .where(inArray(submissions.id, subIds))
          .all();
  const hashBySub = new Map(subRows.map((s2) => [s2.id, s2.missionIdHash]));
  const submittedAt = new Map(subRows.map((s2) => [s2.id, s2.createdAt]));
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
    const sent = r.submissionId ? submittedAt.get(r.submissionId) : undefined;
    /*
      A NEGATIVE WAIT IS A CLOCK PROBLEM, NOT A FAST PAYOUT.
      The settlement's timestamp comes from the events journal and the submit time from the
      submissions table; a row where the money appears to have moved BEFORE the work arrived is
      unmeasurable, not instantaneous, so it is dropped rather than counted as zero.
    */
    const waitSeconds = typeof sent === "number" && r.at >= sent ? r.at - sent : null;
    return {
      wallet: r.wallet ?? "",
      usd: r.amountBase / 1_000_000,
      txHash: r.txHash,
      productHost: surface ? hostOf(surface) : null,
      at: r.at,
      waitSeconds,
    };
  });
  /**
   * ONE ROW PER PERSON IN THE SHOWCASE.
   *
   * Measured 2026-09-04: all eight rows on this board were wallets from the campaign we had already
   * proven belonged to ONE operator — and our own public wallet graph flags them as such. Showing a
   * cluster as eight people is the flattering number, and this page's whole claim is that the
   * flattering number is the one we do not publish. So the showcase collapses linked wallets to
   * their first payout, and the people count is clusters, not addresses.
   *
   * The money totals are untouched: that USDC really did move, and understating it would be its own
   * dishonesty. Only the "how many different people" claim is collapsed, because that is the claim
   * the links actually bear on.
   */
  const seenCluster = new Set<string>();
  const showcase: MarketplacePayout[] = [];
  for (const p of payouts) {
    const cluster = clusterKeyOf(p.wallet);
    if (seenCluster.has(cluster)) continue;
    seenCluster.add(cluster);
    showcase.push(p);
    if (showcase.length >= 8) break;
  }
  const people = new Set(payouts.filter((p) => p.wallet).map((p) => clusterKeyOf(p.wallet)));
  return {
    recentPayouts: showcase,
    paidToDate: { usd: payouts.reduce((sum, p) => sum + p.usd, 0), count: payouts.length, people: people.size },
    speed: waitSummary(payouts),
  };
}

/**
 * THE WAIT, MEASURED — median seconds from a tester pressing submit to the money being on chain.
 *
 * This is the one number in the whole product that no competitor can answer, so it is derived and
 * never typed: every sample is one settled payout minus its own submission's timestamp. Rows whose
 * submit time is unknown are excluded from the median AND counted in nothing — `measured` is how
 * many samples the median actually stands on, so a page can say "over 6" instead of implying it
 * measured every payout it displays.
 */
export function waitSummary(
  payouts: Pick<MarketplacePayout, "waitSeconds" | "txHash" | "usd">[],
): MarketplaceView["speed"] {
  const measurable = payouts
    .filter((p): p is typeof p & { waitSeconds: number } => typeof p.waitSeconds === "number")
    .sort((a, b) => a.waitSeconds - b.waitSeconds);
  if (measurable.length === 0) return { medianSeconds: null, measured: 0, dots: [] };
  const mid = Math.floor(measurable.length / 2);
  const medianSeconds =
    measurable.length % 2 === 1
      ? measurable[mid]!.waitSeconds
      : Math.round((measurable[mid - 1]!.waitSeconds + measurable[mid]!.waitSeconds) / 2);
  return {
    medianSeconds,
    measured: measurable.length,
    // A strip is read, not counted: past a few dozen the marks overlap into a smear and add nothing.
    dots: measurable.slice(0, 40).map((p) => ({ txHash: p.txHash, seconds: p.waitSeconds, usd: p.usd })),
  };
}

/** A wallet's cluster: itself, or the lowest address it is linked to. One person, one key. */
function clusterKeyOf(wallet: string): string {
  if (!wallet) return "";
  const linked = linkedWalletsOf(wallet).map((w) => w.toLowerCase());
  return linked.length > 0 ? linked.slice().sort()[0] : wallet.toLowerCase();
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
  // SAGE FOR TEAMS — an UNLISTED campaign is reachable only through its own door. This is the one
  // listing source (the marketplace page, the sitemap and the agent's mission list all read it),
  // so hiding it here hides it everywhere a stranger could discover it.
  const open = live.filter(isPublicWork);
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
      ...(verificationKindOf(m.verificationContract) ? { verificationKind: verificationKindOf(m.verificationContract) } : {}),
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
