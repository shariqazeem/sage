import { NextResponse, type NextRequest } from "next/server";
import {
  acquireLock,
  getCampaign,
  getDecisionBySubmission,
  getMissionByHash,
  listApprovedSubmissions,
  listPendingAutopilotSubmissionIds,
  releaseLock,
  resetStaleSettling,
} from "@/lib/db/campaigns";
import { nowSeconds } from "@/lib/db/keys";
import { runDeputyOnSubmission } from "@/lib/deputy/pipeline";
import { ensureDecision } from "@/lib/deputy/decisions";
import { hasLlm } from "@/lib/deputy/brain";
import { settleApprovedSubmission } from "@/lib/campaigns/settle-flow";
import { payoutActionReplayMode, runPayoutActionReplay } from "@/lib/deputy/payout-replay";
import { dbReplayJournal } from "@/lib/db/payout-replay-journal";
import { payPendingFees } from "@/lib/x402/fees";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOCK = "deputy_sweep";
const LOCK_TTL = 55; // < maxDuration and < the 5-minute cron interval
const STALE_SETTLING_SEC = 300; // a 'settling' row older than this crashed

/**
 * Authorize a sweep. Accepts our own `x-deputy-cron-secret` (the local watcher /
 * manual calls) OR Vercel Cron's `Authorization: Bearer <CRON_SECRET>`. With no
 * secret configured the endpoint is closed (there is no open trigger).
 */
function authorized(req: NextRequest): boolean {
  const ours = process.env.DEPUTY_CRON_SECRET?.trim();
  if (ours && req.headers.get("x-deputy-cron-secret") === ours) return true;
  const vercel = process.env.CRON_SECRET?.trim();
  if (vercel && req.headers.get("authorization") === `Bearer ${vercel}`) return true;
  return false;
}

async function runSweep() {
  const summary = {
    staleReset: 0,
    retried: 0,
    autopilot: { settled: 0, held: 0, skipped: 0 },
    timelock: { settled: 0, other: 0 },
    fees: { settled: 0, pending: 0 },
  };

  // (0) recover crashed 'settling' rows so they can be re-processed.
  summary.staleReset = resetStaleSettling(nowSeconds() - STALE_SETTLING_SEC);

  // (ii)+(iii) run the pipeline over pending autopilot submissions it missed,
  // retrying a transient LLM failure (a heuristic receipt while a key exists).
  for (const id of listPendingAutopilotSubmissionIds()) {
    const dec = getDecisionBySubmission(id);
    if (dec && dec.engine === "heuristic" && hasLlm()) {
      await ensureDecision(id, { force: true }).catch(() => null);
      summary.retried += 1;
    }
    const r = await runDeputyOnSubmission(id).catch(() => null);
    if (r?.action === "settled") summary.autopilot.settled += 1;
    else if (r?.action === "held") summary.autopilot.held += 1;
    else summary.autopilot.skipped += 1;
  }

  // (i) re-fire settle for approved submissions whose vendor timelock matured. PAYOUT ACTION REPLAY (Phase 4)
  // dominates THIS automated broadcast sink too: for a canary action mission, Sage re-performs the action in a
  // fresh guarded browser (product drift between approval and timelock maturity is exactly this risk) and HOLDS
  // on any non-reproduced result BEFORE settleApprovedSubmission. Subtractive; off by default → no-op.
  for (const sub of listApprovedSubmissions()) {
    const campaign = getCampaign(sub.campaignId);
    if (!campaign) continue;
    if (payoutActionReplayMode() !== "off" && sub.missionIdHash) {
      const mission = getMissionByHash(campaign.id, sub.missionIdHash);
      if (mission) {
        const replay = await runPayoutActionReplay(campaign, mission.missionKey, { journal: dbReplayJournal, submissionId: sub.id }).catch(() => ({ decision: "hold" as const, code: "internal_error" as const }));
        if (replay.decision === "hold") { summary.timelock.other += 1; continue; } // veto → never broadcast
      }
    }
    try {
      const { outcome } = await settleApprovedSubmission(campaign, sub);
      if (outcome.settled) summary.timelock.settled += 1;
      else summary.timelock.other += 1;
    } catch {
      summary.timelock.other += 1;
    }
  }

  // RAIL 2 — pay every pending operator fee over the real x402 rail (live only).
  summary.fees = await payPendingFees();

  return summary;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Singleton: an overlapping tick (or cron + dev watcher) finds the lock held
  // and exits. Idempotent — the CAS + intentHash make re-runs safe anyway.
  if (!acquireLock(LOCK, LOCK_TTL)) {
    return NextResponse.json({ ok: true, skipped: "another sweep is running" });
  }
  try {
    const summary = await runSweep();
    return NextResponse.json({ ok: true, at: nowSeconds(), ...summary });
  } finally {
    releaseLock(LOCK);
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

// Vercel Cron invokes the path with GET — same handler, same auth.
export async function GET(req: NextRequest) {
  return handle(req);
}
