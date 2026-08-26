import { NextResponse, after, type NextRequest } from "next/server";
import {
  acquireLock,
  getCampaign,
  getDecisionBySubmission,
  getMissionByHash,
  listApprovedSubmissions,
  listPendingAutopilotSubmissionIds,
  releaseLock,
  resetStaleSettling,
  listUnresolvedSubmissionsOlderThan,
  hasStaleEvent,
  recordEvent,
  getSubmission,
} from "@/lib/db/campaigns";
import { nowSeconds } from "@/lib/db/keys";
import { runDeputyOnSubmission } from "@/lib/deputy/pipeline";
import { ensureDecision, OBSERVATION_ABSTAIN_MODEL } from "@/lib/deputy/decisions";
import { notifyTelegram } from "@/lib/deputy/notify";
import { hasLlm } from "@/lib/deputy/brain";
import { settleApprovedSubmission } from "@/lib/campaigns/settle-flow";
import { payoutActionReplayMode, runPayoutActionReplay } from "@/lib/deputy/payout-replay";
import { dbReplayJournal } from "@/lib/db/payout-replay-journal";
import { payPendingFees } from "@/lib/x402/fees";
import { runCampaignHealthNudges } from "@/lib/campaigns/health-nudge";
import { reapStalledInspections } from "@/lib/launch/job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOCK = "deputy_sweep";
const LOCK_TTL = 55; // < maxDuration and < the 5-minute cron interval
const STALE_SETTLING_SEC = 300; // a 'settling' row older than this crashed
/**
 * How long a heuristic receipt stays eligible for a paid LLM upgrade. A transient provider outage
 * resolves in minutes; anything still failing after two hours is persistent, and retrying it every
 * five minutes forever is how ~$9 of credits burned on 2026-08-18 with nobody using the system.
 */
const LLM_UPGRADE_MAX_AGE_SEC = 2 * 3600;

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
    /** never-arrives guard: unresolved submissions past the silence bound flagged this tick. */
    stale: 0,
    /** heuristic receipts too old to keep buying an LLM upgrade for — the spend ceiling working. */
    upgradeExpired: 0,
    /** inspection jobs whose runner died, recovered this tick. */
    inspections: { retried: 0, failed: 0 },
    /** one-time quiet-campaign founder nudges sent this tick (48h, zero submissions). */
    nudges: { nudged: 0 },
  };

  // (0) recover crashed 'settling' rows so they can be re-processed.
  summary.staleReset = resetStaleSettling(nowSeconds() - STALE_SETTLING_SEC);

  // (0b) NEVER-ARRIVES GUARD — the standing invariant that no submission sits unresolved past the
  // silence bound, WHATEVER the cause. The processing loop below rightly skips terminal campaigns
  // (their vaults can never settle) — which is exactly how two testers sat "verifying" on the public
  // board for 14–15 days until a human stumbled on them. A wrong answer is survivable; silence is
  // not. This journals + notifies the operator once as each row crosses the bound (the crossing
  // window matches the sweep cadence, so it fires ~once per row, without any new schema).
  {
    const STALE_SUBMISSION_SEC = 24 * 3600; // the silence bound
    const now = nowSeconds();
    for (const s of listUnresolvedSubmissionsOlderThan(now - STALE_SUBMISSION_SEC)) {
      const age = now - s.createdAt;
      summary.stale += 1;
      // Fire once PER ROW, not once per time window. A window only fires for rows that cross the
      // bound while the sweeper happens to be running, so an outage — the case most likely to leave
      // a tester waiting — would produce no alert at all. The journal remembers instead.
      if (!hasStaleEvent(s.id)) {
        recordEvent({
          campaignId: s.campaignId,
          submissionId: s.id,
          kind: "submission_stale",
          // A tester can read this. It says what is true, and that it is our problem, not theirs.
          detail: `Still unresolved after ${Math.round(age / 3600)}h. Flagged for a human to finish it.`,
        });
        void notifyTelegram(
          `⚠️ <b>Stale submission</b>\n${s.id} unresolved for ${Math.round(age / 3600)}h (status ${s.status}, campaign ${s.campaignStatus}). No tester should wait in silence — resolve or refund it.`,
        );
      }
    }
  }

  // (ii)+(iii) run the pipeline over pending autopilot submissions it missed,
  // retrying a transient LLM failure (a heuristic receipt while a key exists).
  for (const id of listPendingAutopilotSubmissionIds()) {
    const dec = getDecisionBySubmission(id);
    /**
     * THE UPGRADE RETRY IS BOUNDED BY AGE — because an unbounded one bills forever.
     *
     * MEASURED 2026-08-18: nine submissions on a dead campaign each carried a heuristic receipt
     * (the brain kept returning output the strict brief parser rejected). This branch forced a
     * fresh LLM decision on all nine every tick; each attempt retried 3× and then through the
     * fallback provider, so ~650 CALLS AN HOUR were billed and discarded — around $9 of credits in
     * a few hours with no user on the system. Nothing recorded it: a failed brain run writes no
     * `decisions` row, so the loop was invisible to every DB-level check and showed up only in the
     * error log.
     *
     * The retry exists for a TRANSIENT outage — the LLM is briefly down, a heuristic receipt gets
     * written, and the upgrade lands minutes later. A failure still unresolved hours later is not
     * transient, it is persistent, and paying to rediscover that on a five-minute cadence is pure
     * waste. Past the bound the heuristic receipt stands (it can never auto-pay) and the
     * never-arrives guard above already escalates the row to a human.
     */
    // An observation-lane ABSTAIN is a correct FINAL receipt, not a degraded one — there is no LLM
    // upgrade to buy. Without this exclusion the sweep would delete + reinsert it every tick.
    const wantsUpgrade =
      !!dec && dec.engine === "heuristic" && dec.model !== OBSERVATION_ABSTAIN_MODEL && hasLlm();
    const withinBound =
      nowSeconds() - (getSubmission(id)?.createdAt ?? 0) < LLM_UPGRADE_MAX_AGE_SEC;
    if (wantsUpgrade && withinBound) {
      await ensureDecision(id, { force: true }).catch(() => null);
      summary.retried += 1;
    } else if (wantsUpgrade) {
      summary.upgradeExpired += 1;
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

  // (ii) INSPECTION JOBS WHOSE RUNNER DIED. Reaping used to happen only when a founder loaded their
  // status page, so a founder who closed the tab left a job saying "Sage is working" forever —
  // measured on prod as five stuck jobs, the oldest idle for over sixty hours. Every deploy restart
  // kills in-flight `after()` work, so this is routine, not exotic. `after()` keeps the retries off
  // the sweep's own response; the batch is small because each retry is a real browser run.
  summary.inspections = reapStalledInspections((fn) => after(fn));

  // RAIL 2 — pay every pending operator fee over the real x402 rail (live only).
  summary.fees = await payPendingFees();

  // LIFECYCLE SENSE (FC Phase 3) — one-time quiet-campaign nudges. Best-effort, never blocks.
  summary.nudges = await runCampaignHealthNudges().catch(() => ({ nudged: 0 }));

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
