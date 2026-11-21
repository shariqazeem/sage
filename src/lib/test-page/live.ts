import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";
import type { Campaign, Submission } from "@/lib/db/schema";
import { getDecisionBySubmission, listCampaignEvents, listSubmissions } from "@/lib/db/campaigns";
import { getInspectionJobByCampaign } from "@/lib/db/inspection";
import { sameFounder } from "@/lib/auth/founder";
import { campaignAutopays } from "@/lib/campaigns/autopay-status";
import { listHeldSubmissions, ownsCampaign } from "@/lib/campaigns/review-actions";
import { v2Economics, type V2MissionView } from "@/lib/campaigns/v2-economics";
import { isPublicWork } from "@/lib/campaigns/visibility";
import { chainConfig } from "@/lib/deputy/networks";
import { finalizationFor } from "@/lib/deputy/finalization-db";
import { nowSeconds } from "@/lib/db/keys";
import { short } from "@/lib/format";
import { seatLinkFor } from "@/lib/people/link-info";
import { linkFor, seatHolders } from "@/lib/people/seats";
import { findingsView, notPaidReason, type FindingsView } from "@/lib/report";
import { sageReadsOnly } from "@/lib/launch/product-kind";
import { firstLookView, type FirstLookView } from "./first-look";
import { sharingFor, type Sharing } from "@/lib/sharing";
import { framesOf, type RealFrame } from "@/lib/site/real-test-frames";
import { testUrl } from "@/lib/site/test-url";
import { hostOf } from "@/lib/site/when";
import { summarizeSettled } from "@/lib/telegram/format";
import { productName } from "@/lib/x/agent";
import { resultText } from "@/lib/x/compose";
import { resultFactsFor } from "@/lib/x/result-facts";
import { firstUsersView, type FirstUsersView } from "@/lib/users";
import type { TicketState } from "@/components/sage/ticket";

/**
 * A TEST ONCE IT IS PAID FOR, as its page reads it (relaunch, 20 Nov 2026).
 *
 * People are tickets. Every ticket is a row: a submission, or a place someone took through the
 * builder's own link. Its state is the row's state, its amount is the mission's reward, a paid one
 * links its receipt, and one that was not paid says why in the recorded words.
 *
 * WHO SEES WHAT. The owner sees every wallet. Anyone else sees a wallet only once it has been paid
 * (the payout is public on the chain already); a person still being checked is "Tester 3" and never
 * their address, and nobody but the owner and the judge ever sees an answer here. The visitor's own
 * ticket is marked so their page can find it.
 */
export interface LiveTicket {
  key: string;
  handle: string;
  state: TicketState;
  amount: string;
  reason: string | null;
  receipt: string | null;
  /** unix seconds of the last thing that happened to it */
  at: number;
  mine: boolean;
  /**
   * THE OWNER'S ALONE: Sage approved this answer and it has not settled, so the builder may still say
   * "not a real try" (POST /api/submissions/<id>/flag). `until` is when the window closes, unix seconds.
   */
  flag?: { submissionId: string; until: number };
}

export type LiveMission = V2MissionView;

export interface LiveOwner {
  sharing: Sharing;
  /** the vault is the session's own wallet's: that wallet stops it. False: an account Sage holds does. */
  ownVault: boolean;
  vaultAddress: string;
  explorerUrl: string;
  /** answers waiting for the builder's own yes or no */
  held: number;
  /** the builder's link for their own people, when the test is for them only */
  seatLink: { url: string; seats: number; taken: number } | null;
  /** the exact words Sage would post when the test ends, from today's answers; null when there is nothing to say yet */
  resultPost: string | null;
  /**
   * "Get your first users": drafts in the builder's own voice that link their PRODUCT, and where to post
   * them. Null when the test has no product address. Written by code on every read; never a model here.
   */
  users: FirstUsersView | null;
}

export interface LiveView {
  id: string;
  title: string;
  host: string | null;
  productUrl: string | null;
  status: string;
  /** done: no place can be taken any more (every place paid, or the test was stopped or ended) */
  phase: "live" | "done";
  viewer: "owner" | "public";
  chainId: number;
  network: string;
  campaignIdHash: string;
  rail: "evm" | "starknet";
  autopays: boolean;
  inviteOnly: boolean;
  missions: LiveMission[];
  places: { total: number; paid: number; checking: number; left: number };
  tickets: LiveTicket[];
  money: { fundedBase: number; paidBase: number; unspentBase: number };
  frames: RealFrame[];
  run: { steps: number; seconds: number | null } | null;
  /** what Sage read where it could not use the product itself ("the store listing"); null when it tried it */
  sageReads: string | null;
  /**
   * What Sage itself noticed. The owner's while the test is live: it holds things Sage saw, and a
   * tester must not read those before answering. Once the test is done and its findings are public,
   * anyone may (never a look taken with the builder's own test account).
   */
  firstLook: FirstLookView | null;
  /** the findings, when this visitor may read them */
  findings: Omit<FindingsView, "rebuilding"> | null;
  owner: LiveOwner | null;
  shareUrl: string;
}

const IN_FLIGHT = new Set(["pending", "approved", "settling"]);
const usd = (base: number): string => `$${(base / 1_000_000).toFixed(2)}`;

function stateOf(s: Submission): TicketState {
  if (s.status === "paid") return "paid";
  if (s.status === "rejected" || s.status === "blocked") return "not-paid";
  // answered: it has arrived and nothing has judged it yet. checking: Sage has read it (it is held
  // for a second look or for the builder), or it is approved and waiting to be paid.
  if (s.status === "pending" && !getDecisionBySubmission(s.id)) return "answered";
  return "checking";
}

function framesFor(campaign: Campaign, owner: boolean): { frames: RealFrame[]; run: LiveView["run"]; productUrl: string | null } {
  const job = getInspectionJobByCampaign(campaign.id);
  if (!job) return { frames: [], run: null, productUrl: null };
  const host = hostOf(job.productUrl);
  const fieldTest = (job.result as { map?: { fieldTest?: unknown } } | null)?.map?.fieldTest;
  // frames from a run with the builder's own test account are the owner's to see, and nobody else's
  if (!host || !fieldTest || (job.testAccountSealed && !owner)) return { frames: [], run: null, productUrl: job.productUrl };
  const picked = framesOf(fieldTest, host, 4);
  if (!picked) return { frames: [], run: null, productUrl: job.productUrl };
  const frames = picked.frames
    .filter((f) => existsSync(path.join(process.cwd(), "public", "field-tests", job.id, `${f.file}.png`)))
    .map((f) => ({ ...f, src: `/api/field-tests/${job.id}/${f.file}` }));
  return { frames, run: { steps: picked.steps, seconds: picked.seconds }, productUrl: job.productUrl };
}

export function liveView(campaign: Campaign, viewer: string | null): LiveView {
  const owner = ownsCampaign(campaign, viewer);
  const e = v2Economics(campaign);
  const subs = listSubmissions(campaign.id);
  const events = listCampaignEvents(campaign.id);
  const sharing = sharingFor(campaign.id);
  const rewardOf = new Map(e.missions.map((m) => [m.missionIdHash, m.rewardBase]));
  const amountOf = (s: Submission): number => (s.missionIdHash ? rewardOf.get(s.missionIdHash) : undefined) ?? campaign.rewardAmount;

  // oldest first, so "Tester 3" is the third person who answered and stays the third
  const now = nowSeconds();
  const builderSaid = (s: Submission): string | null => (s.rejectReason?.startsWith("The builder said:") ? s.rejectReason.slice(0, 240) : null);
  const ordered = [...subs].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const tickets: LiveTicket[] = ordered.map((s, i) => {
    const state = stateOf(s);
    const mine = !!viewer && sameFounder(s.wallet, viewer);
    let flag: LiveTicket["flag"];
    if (owner && s.status === "approved") {
      const fin = finalizationFor(s, campaign.visibility, now);
      if (fin.state === "waiting") flag = { submissionId: s.id, until: fin.finalizesAt };
    }
    return {
      ...(flag ? { flag } : {}),
      key: s.id,
      handle: owner || state === "paid" ? short(s.wallet) : mine ? "You" : `Tester ${i + 1}`,
      state,
      amount: usd(amountOf(s)),
      // the builder's own words about an answer are shown as written, to everyone
      reason: state === "not-paid" ? (builderSaid(s) ?? notPaidReason(s, owner ? "owner" : "public")) : null,
      receipt: state === "paid" && s.payoutTx ? `/proof/${s.payoutTx}` : null,
      at: s.decidedAt ?? s.createdAt,
      mine,
    };
  });
  // a place taken through the builder's link, before any answer
  const answered = new Set(subs.map((s) => s.wallet.toLowerCase()));
  const each = e.missions[0]?.rewardBase ?? campaign.rewardAmount;
  seatHolders(campaign.id).forEach((wallet, i) => {
    if (answered.has(wallet.toLowerCase())) return;
    const mine = !!viewer && sameFounder(wallet, viewer);
    tickets.push({ key: `seat:${i}`, handle: owner ? short(wallet) : mine ? "You" : "An invited tester", state: "took-a-place", amount: usd(each), reason: null, receipt: null, at: 0, mine });
  });
  tickets.sort((a, b) => b.at - a.at);

  const total = e.totalCompletions;
  const paid = e.paidCompletions;
  const checking = subs.filter((s) => IN_FLIGHT.has(s.status)).length;
  const left = Math.max(0, total - paid - checking);
  const phase: LiveView["phase"] = campaign.status !== "live" || (total > 0 && paid >= total) ? "done" : "live";
  const { settledBase } = summarizeSettled(events);

  // NO CORPUS ORACLE (CLAUDE.md). Sage's frames carry what it saw (each frame's description is the very text
  // the observation judge checks answers against), and paid answers can be copied. While places are open,
  // only the owner sees either; once the test is done, the frames are anyone's and the findings are public
  // if the builder said so.
  const mayShowRun = owner || phase === "done";
  const { frames, run, productUrl } = mayShowRun ? framesFor(campaign, owner) : { frames: [], run: null, productUrl: getInspectionJobByCampaign(campaign.id)?.productUrl ?? null };
  const mayRead = owner || (sharing.findingsPublic && phase === "done");
  const lookJob = getInspectionJobByCampaign(campaign.id);
  const findings = mayRead ? findingsView(campaign, owner ? "owner" : "public", sharing.findingsPublic) : null;

  let ownerView: LiveOwner | null = null;
  if (owner && viewer) {
    const inviteOnly = !isPublicWork(campaign);
    let seatLink: LiveOwner["seatLink"] = null;
    if (inviteOnly && (campaign.status === "live" || campaign.status === "draft")) {
      try {
        // one link for every place in the test, minted once
        linkFor({ campaignId: campaign.id }, viewer, total);
        const l = seatLinkFor(campaign, viewer);
        seatLink = { url: l.url, seats: l.seats, taken: l.taken };
      } catch {
        seatLink = null;
      }
    }
    const people = new Set(subs.filter((s) => s.status === "paid").map((s) => s.wallet.toLowerCase())).size;
    const product = productName(campaign);
    const found = people > 0 ? resultFactsFor(campaign.id) : null;
    const post = product && found ? resultText({ product, people, finding: found.finding, quote: found.quote, onMetis: campaign.chainId === 1088, url: testUrl(campaign.id) }) : null;
    ownerView = {
      sharing,
      ownVault: sameFounder(campaign.posterWallet, viewer),
      vaultAddress: campaign.vaultAddress,
      explorerUrl: chainConfig(campaign.chainId).explorerUrl,
      held: listHeldSubmissions(campaign).length,
      seatLink,
      resultPost: post ? post.text : null,
      users: firstUsersView(campaign, findings, { done: phase === "done", now }),
    };
  }

  return {
    id: campaign.id,
    title: campaign.title,
    host: productUrl ? hostOf(productUrl) : null,
    productUrl,
    status: campaign.status,
    phase,
    viewer: owner ? "owner" : "public",
    chainId: e.chainId,
    network: chainConfig(e.chainId).name,
    campaignIdHash: campaign.campaignIdHash ?? `0x${"0".repeat(64)}`,
    rail: campaign.settlementRail === "starknet" ? "starknet" : "evm",
    autopays: campaignAutopays(campaign, e.missions, e.isTestnet),
    inviteOnly: !isPublicWork(campaign),
    missions: e.missions,
    places: { total, paid, checking, left },
    tickets,
    money: { fundedBase: e.totalFundedBase, paidBase: settledBase, unspentBase: Math.max(0, e.totalFundedBase - settledBase) },
    frames,
    run,
    sageReads: lookJob ? sageReadsOnly((lookJob.result as { map?: { productKind?: unknown } } | null)?.map ?? null, lookJob.productUrl) : null,
    firstLook: lookJob && (owner || (phase === "done" && sharing.findingsPublic && !lookJob.testAccountSealed)) ? firstLookView(lookJob) : null,
    findings,
    owner: ownerView,
    shareUrl: testUrl(campaign.id),
  };
}
