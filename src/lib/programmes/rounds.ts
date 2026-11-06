import "server-only";

import { getAddress } from "viem";
import { z } from "zod";

import { getAgentWalletByAddress } from "@/lib/db/agent-wallets";
import { appendToAllowlist, getCampaign, getDecisionBySubmission, listSubmissions, resolveStoppedCampaignSubmissions, setCampaignStatus } from "@/lib/db/campaigns";
import { getInspectionJob } from "@/lib/db/inspection";
import { nowSeconds } from "@/lib/db/keys";
import type { Programme } from "@/lib/db/schema";
import { notifyTelegram } from "@/lib/deputy/notify";
import { chainConfig } from "@/lib/deputy/networks";
import { createDirectCampaign, DIRECT_LIMITS, type DirectCampaignInput } from "@/lib/launch/direct-campaign";
import { seatHolders } from "@/lib/people/seats";
import { stopCampaignViaPrivy } from "@/lib/privy/stop-campaign";
import { launchFromTreasury, type TreasuryLaunch } from "@/lib/treasury/launch";
import { beginRound, dueProgrammes, endProgramme, getRound, listRounds, markRoundClosed, markRoundLive, noteRoundAttempt, skipRound } from "./store";

/**
 * TIME: SAGE RUNS THE SAME APPROVED JOB EVERY WEEK, FOR THE SAME PEOPLE (6 Nov 2026).
 *
 * 10,000 payouts across 700 people is about 14 each: the same people, paid again and again. Before this,
 * every round of a programme was a new launch the founder had to remember, and nothing repeated.
 *
 * The founder approves a season once, on the card ("every week, for 8 weeks"), and funds it. Round 1
 * launches there and then. Each tick of the sweep then does this for each programme with a round due:
 *   1. The last round closes first, once nothing in it is moving. Its vault is stopped through the account,
 *      and its leftover returns to the account. Work a founder is still reviewing keeps its round open.
 *   2. The next round launches from the account: the SAME spec the founder approved (amounts, missions,
 *      proofs), for the same people. The programme's link holders are its named list. `launchFromTreasury`
 *      runs every check a launch from the card runs: the plan's limits (`launchAllowed`), the account's
 *      per-job cap, its balance and its network fee. Sage never sizes anything.
 *   3. A round that cannot launch says why in the founder's words, retries every 6 hours, and after 3 days
 *      is skipped so the schedule moves on. Nothing is charged twice: the round's row is written before any
 *      money moves, its job is compiled once and reused by every retry, and a job whose vault is already
 *      recorded is picked up, never launched again.
 */

export const EVERY_DAYS = [7, 14, 30] as const;
export const ROUNDS_MAX = 26;
export const repeatSchema = z.object({
  everyDays: z.union([z.literal(7), z.literal(14), z.literal(30)]),
  rounds: z.number().int().min(2).max(ROUNDS_MAX),
});
export type Repeat = z.infer<typeof repeatSchema>;

export const RETRY_EVERY_S = 6 * 3600;
export const GIVE_UP_AFTER_S = 3 * 86_400;
/** How long a due round waits for work still moving in the last one before it opens alongside it. */
export const WAIT_FOR_MOVING_S = 6 * 3600;

const period = (everyDays: number) => (everyDays === 7 ? "week" : everyDays === 14 ? "fortnight" : "month");

/** "Thread about Metis (week 3)", inside the spec's 80-character title limit. */
export function roundTitle(title: string, round: number, everyDays: number): string {
  const tag = ` (${period(everyDays)} ${round})`;
  return `${title.slice(0, 80 - tag.length).trimEnd()}${tag}`;
}

/** The spec a round launches: the approved one, its title marked with the round, its people the link holders. */
export function roundSpec(p: Programme, round: number, seats: string[]): DirectCampaignInput {
  const spec = { ...(p.spec as unknown as DirectCampaignInput) };
  spec.title = roundTitle(p.title, round, p.everyDays);
  // Work for the founder's own people admits the link holders by name. Public work stays public.
  if (spec.visibility === "unlisted") {
    if (seats.length > 0) spec.allowlist = seats.slice(0, DIRECT_LIMITS.allowlistMax);
    else delete spec.allowlist;
  }
  return spec;
}

/** Work still moving in a round: being judged, paying out, or approved inside its window. Held work is separate. */
export function workInRound(campaignId: string): { moving: number; held: number } {
  let moving = 0;
  let held = 0;
  for (const s of listSubmissions(campaignId)) {
    if (s.status === "settling" || s.status === "approved") moving++;
    // pending with a decision is held for the founder; pending without one is still being judged
    else if (s.status === "pending" && getDecisionBySubmission(s.id)) held++;
    else if (s.status === "pending") moving++;
  }
  return { moving, held };
}

/**
 * Everyone holding a place when a round goes live is on its named list, including anyone who joined while
 * the round was still trying to open. Only work for the founder's own people: appending to public work
 * would turn it into a named list and lock everyone else out.
 */
export function admitSeatHolders(p: Programme, campaignId: string): void {
  if ((p.spec as { visibility?: string }).visibility !== "unlisted") return;
  for (const w of seatHolders(p.id)) appendToAllowlist(campaignId, w);
}

export interface RoundDeps {
  create: (spec: DirectCampaignInput, founder: string) => { ok: true; jobId: string } | { ok: false; error: string };
  launch: (founder: string, jobId: string, chainId: number) => Promise<TreasuryLaunch>;
  close: (campaignId: string) => Promise<{ ok: boolean; error?: string }>;
  notify: (text: string) => Promise<void>;
}

/** Stop a finished round through the account that launched it; its leftover returns to that account. */
async function closeRound(campaignId: string): Promise<{ ok: boolean; error?: string }> {
  const c = getCampaign(campaignId);
  if (!c) return { ok: true };
  if (c.status !== "live") return { ok: true };
  const account = getAgentWalletByAddress(c.posterWallet);
  if (account && c.vaultAddress && chainConfig(c.chainId).evm) {
    try {
      await stopCampaignViaPrivy(account, getAddress(c.vaultAddress));
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "the stop failed" };
    }
  }
  setCampaignStatus(campaignId, "cancelled");
  resolveStoppedCampaignSubmissions(campaignId);
  return { ok: true };
}

export const liveDeps: RoundDeps = {
  create: (spec, founder) => {
    const r = createDirectCampaign(spec, founder, null);
    return r.ok ? { ok: true, jobId: r.jobId } : { ok: false, error: r.error };
  },
  launch: launchFromTreasury,
  close: closeRound,
  notify: notifyTelegram,
};

export interface RoundsSummary {
  due: number;
  opened: number;
  waiting: number;
  failed: number;
  skipped: number;
  closed: number;
}

/** The round after the last one that opened or was skipped. */
export function nextRoundNumber(programmeId: string): number {
  return listRounds(programmeId).reduce((m, r) => (r.status === "live" || r.status === "skipped" ? Math.max(m, r.round) : m), 0) + 1;
}

export async function openDueRounds(now = nowSeconds(), deps: RoundDeps = liveDeps): Promise<RoundsSummary> {
  const sum: RoundsSummary = { due: 0, opened: 0, waiting: 0, failed: 0, skipped: 0, closed: 0 };
  for (const p of dueProgrammes(now)) {
    sum.due++;
    const n = nextRoundNumber(p.id);
    const label = `"${p.title}" ${period(p.everyDays)} ${n} of ${p.roundsTotal}`;

    // 1. The last round closes first, once nothing in it is moving.
    const prev = getRound(p.id, n - 1);
    if (prev?.status === "live" && prev.campaignId && !prev.closedAt) {
      const work = workInRound(prev.campaignId);
      if (work.moving > 0 && now - (p.nextRoundAt ?? now) < WAIT_FOR_MOVING_S) {
        sum.waiting++;
        continue;
      }
      if (work.moving === 0 && work.held === 0) {
        const closed = await deps.close(prev.campaignId).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : "close failed" }));
        if (closed.ok) {
          markRoundClosed(p.id, prev.round, now);
          sum.closed++;
        }
        // a close that failed leaves that round open: the next one may still launch alongside it
      }
    }
    // The last round has had its period: the season is over. Held work keeps its round open for review.
    if (n > p.roundsTotal) {
      endProgramme(p.id, now);
      continue;
    }

    // 2. The round itself, once.
    const row = beginRound(p.id, n, now);
    if (!row || row.status === "live" || row.status === "skipped") continue;
    if (row.attempts > 0 && row.lastAttemptAt && now - row.lastAttemptAt < RETRY_EVERY_S) continue;
    if (now - (p.nextRoundAt ?? now) > GIVE_UP_AFTER_S) {
      skipRound(p.id, n, row.error ?? "it could not open in time", now);
      sum.skipped++;
      await deps.notify(`<b>Sage skipped ${label}</b>\nIt could not open for 3 days: ${row.error ?? "unknown"}. The next one is scheduled as usual.`).catch(() => undefined);
      continue;
    }

    // Compile the round's job once; every retry launches that same job.
    let jobId = row.jobId;
    if (!jobId) {
      const made = deps.create(roundSpec(p, n, seatHolders(p.id)), p.founderWallet);
      if (!made.ok) {
        noteRoundAttempt(p.id, n, { status: "failed", error: `the approved job no longer compiles: ${made.error}` }, now);
        sum.failed++;
        continue;
      }
      jobId = made.jobId;
      noteRoundAttempt(p.id, n, { jobId, status: "opening", error: null }, now);
    }
    // A vault already recorded for this job went live before a crash: pick it up, never launch again.
    const job = getInspectionJob(jobId);
    const already = job ? getCampaign(job.publicCampaignId) : null;
    if (already) {
      markRoundLive(p.id, n, already.id, now);
      admitSeatHolders(p, already.id);
      sum.opened++;
      continue;
    }
    const launched = await deps.launch(p.founderWallet, jobId, p.chainId).catch(
      (e: unknown): TreasuryLaunch => ({ ok: false, reason: "failed", message: e instanceof Error ? e.message.slice(0, 200) : "launch failed" }),
    );
    if (launched.ok) {
      markRoundLive(p.id, n, launched.campaignId, now);
      admitSeatHolders(p, launched.campaignId);
      sum.opened++;
      const people = seatHolders(p.id).length;
      await deps
        .notify(`<b>Sage opened ${label}</b>\n${people} ${people === 1 ? "person is" : "people are"} in. $${(p.roundBudgetBase / 1e6).toFixed(2)} from the account, the same job and amounts as approved.`)
        .catch(() => undefined);
    } else {
      noteRoundAttempt(p.id, n, { status: "failed", error: launched.message }, now);
      sum.failed++;
      if (row.attempts === 0) await deps.notify(`<b>${label} could not open yet</b>\n${launched.message}\nSage tries again every 6 hours.`).catch(() => undefined);
    }
  }
  return sum;
}
