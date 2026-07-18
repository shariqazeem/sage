import "server-only";

import { and, desc, eq, gte, inArray, isNotNull, lt, lte, ne, notInArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./index";
import {
  campaigns,
  decisions,
  events,
  fees,
  locks,
  missions,
  submissions,
  vaultCursors,
  type Campaign,
  type CampaignEvent,
  type Decision,
  type EventKind,
  type Fee,
  type Mission,
  type NewCampaign,
  type NewCampaignEvent,
  type NewDecision,
  type NewMission,
  type NewSubmission,
  type Submission,
} from "./schema";
import type { DecisionBriefContent } from "../deputy/brain-core";
import { missionSpecDigest, type MissionSpecInput } from "../campaigns/mission-spec";
import { dedupeKey, missionDedupeKey, nowSeconds } from "./keys";

/* ─────────────────────────────────────────────────────── campaigns ────── */

export function createCampaign(
  input: Omit<NewCampaign, "id" | "createdAt">,
): Campaign {
  const id = nanoid(10);
  db.insert(campaigns)
    .values({ ...input, id, createdAt: nowSeconds() })
    .run();
  return getCampaign(id) as Campaign;
}

export function getCampaign(id: string): Campaign | null {
  return db.select().from(campaigns).where(eq(campaigns.id, id)).get() ?? null;
}

/** The fixed id of the public "try to jailbreak the Deputy" sandbox campaign. */
export const SANDBOX_CAMPAIGN_ID = "redteam-sandbox";
const SANDBOX_VAULT = "0x0000000000000000000000000000000000000000";

/**
 * Seed the ONE sandbox campaign that backs the public red-team box. It can NEVER
 * settle (settleSubmission throws for it + the autonomy pipeline early-returns),
 * never solicits real submissions (status "paused"), and is excluded from
 * reputation. Idempotent — the fixed id means a second call is a no-op.
 */
export function ensureSandboxCampaign(): Campaign {
  const existing = getCampaign(SANDBOX_CAMPAIGN_ID);
  if (existing) return existing;
  try {
    db.insert(campaigns)
      .values({
        id: SANDBOX_CAMPAIGN_ID,
        title: "Try to jailbreak the Deputy",
        descriptionMd:
          "A public sandbox. Your text runs through Sage's real verification pipeline — the same frozen brain that guards real payouts. Nothing here can move money.",
        criteria: [
          "Reported a genuine bug in Sage's /app onboarding",
          "Included a resolvable link to your write-up",
        ],
        conditionType: "approval",
        rewardAmount: 500_000, // 0.5 USDC — never paid; the vault is unreachable here
        maxRecipients: 0,
        vaultAddress: SANDBOX_VAULT,
        chainId: 59902,
        posterWallet: SANDBOX_VAULT,
        ownerIsSage: true,
        status: "paused", // never accepts /c submissions; the box is the surface
        autonomy: "manual",
        autopilotThreshold: 0.85,
        sandbox: true,
        createdAt: nowSeconds(),
      })
      .run();
  } catch {
    /* lost a seed race — the existing row stands */
  }
  return getCampaign(SANDBOX_CAMPAIGN_ID) as Campaign;
}

export function listCampaigns(): Campaign[] {
  return db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).all();
}

export function listLiveCampaigns(): Campaign[] {
  return db
    .select()
    .from(campaigns)
    .where(eq(campaigns.status, "live"))
    .orderBy(desc(campaigns.createdAt))
    .all();
}

export function setCampaignStatus(id: string, status: Campaign["status"]): void {
  db.update(campaigns).set({ status }).where(eq(campaigns.id, id)).run();
}

/** Update a campaign's standing mandate (autonomy + autopilot threshold). */
export function updateCampaignAutonomy(
  id: string,
  patch: { autonomy: "manual" | "autopilot"; autopilotThreshold: number },
): void {
  db.update(campaigns).set(patch).where(eq(campaigns.id, id)).run();
}

/** Set (or clear, with null) the public Telegram chat a campaign announces to. */
export function updateCampaignAnnounce(id: string, announceChatId: string | null): void {
  db.update(campaigns).set({ announceChatId }).where(eq(campaigns.id, id)).run();
}

/**
 * Bind a campaign to its deployed CampaignVault V2 plan: the vault kind, the on-chain
 * campaign identity hash, the immutable mission-plan digest, and the commitment
 * version. Set once at onboarding (after the vault is deployed + its plan hashed);
 * these are the values the DB↔chain agreement check compares against the vault.
 */
export function updateCampaignV2Plan(
  id: string,
  patch: {
    vaultKind: Campaign["vaultKind"];
    campaignIdHash: string;
    missionPlanDigest: string;
    commitmentVersion: number;
  },
): void {
  db.update(campaigns).set(patch).where(eq(campaigns.id, id)).run();
}

/* ────────────────────────────────────────────────────── submissions ───── */

export function listSubmissions(campaignId: string): Submission[] {
  return db
    .select()
    .from(submissions)
    .where(eq(submissions.campaignId, campaignId))
    .orderBy(desc(submissions.createdAt))
    .all();
}

export function getSubmission(id: string): Submission | null {
  return db.select().from(submissions).where(eq(submissions.id, id)).get() ?? null;
}

/** A wallet's submission to a SPECIFIC V2 mission (keyed by the mission-scoped dedupe key). */
export function getWalletMissionSubmission(missionIdHash: string, wallet: string): Submission | null {
  return (
    db.select().from(submissions).where(eq(submissions.dedupeKey, missionDedupeKey(missionIdHash, wallet))).get() ?? null
  );
}

export function getWalletSubmission(
  campaignId: string,
  wallet: string,
): Submission | null {
  return (
    db
      .select()
      .from(submissions)
      .where(eq(submissions.dedupeKey, dedupeKey(campaignId, wallet)))
      .get() ?? null
  );
}

/** The campaign a settled payout tx belongs to (for the public proof page). */
export function getCampaignByPayoutTx(txHash: string): Campaign | null {
  const sub = db
    .select()
    .from(submissions)
    .where(eq(submissions.payoutTx, txHash.toLowerCase()))
    .get();
  return sub ? getCampaign(sub.campaignId) : null;
}

/** The stored decision behind a payout tx (submission matched by payoutTx), or null. */
export function getDecisionByPayoutTx(txHash: string): Decision | null {
  const sub = db
    .select()
    .from(submissions)
    .where(eq(submissions.payoutTx, txHash.toLowerCase()))
    .get();
  return sub ? getDecisionBySubmission(sub.id) : null;
}

export type SubmitResult =
  | { ok: true; submission: Submission }
  | {
      ok: false;
      error: "duplicate_wallet" | "duplicate_mission" | "duplicate_evidence" | "unknown";
    };

/** Insert a submission; the DB unique indexes enforce dedupe (surfaced politely). */
export function createSubmission(input: {
  campaignId: string;
  wallet: string;
  evidenceUrl?: string | null;
  note?: string | null;
  /** V2: the mission (bytes32 hex) this submission targets, else null (legacy). */
  missionIdHash?: string | null;
  /** V2: the MissionSpecV1 digest captured for this submission (integrity anchor). */
  missionSpecDigest?: string | null;
}): SubmitResult {
  const id = nanoid(12);
  const row: NewSubmission = {
    id,
    campaignId: input.campaignId,
    wallet: input.wallet,
    evidenceUrl: input.evidenceUrl ?? null,
    note: input.note ?? null,
    missionIdHash: input.missionIdHash ?? null,
    missionSpecDigest: input.missionSpecDigest ?? null,
    // Per-MISSION uniqueness for V2 (one wallet, one payout per mission), per-campaign
    // for V1 — one column, one unique index, keys that never collide across kinds.
    dedupeKey: input.missionIdHash
      ? missionDedupeKey(input.missionIdHash, input.wallet)
      : dedupeKey(input.campaignId, input.wallet),
    status: "pending",
    createdAt: nowSeconds(),
  };
  try {
    db.insert(submissions).values(row).run();
    return { ok: true, submission: getSubmission(id) as Submission };
  } catch (err) {
    // SQLite reports a unique-index violation by COLUMN ("...failed: submissions.dedupe_key"),
    // not by index name — match the columns (and keep the index names as a fallback).
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes("dedupe_key") || msg.includes("sub_dedupe_unq")) {
      return { ok: false, error: input.missionIdHash ? "duplicate_mission" : "duplicate_wallet" };
    }
    if (msg.includes("evidence_url") || msg.includes("sub_evidence_unq")) {
      return { ok: false, error: "duplicate_evidence" };
    }
    return { ok: false, error: "unknown" };
  }
}

export function updateSubmission(
  id: string,
  patch: Partial<
    Pick<Submission, "status" | "rejectReason" | "payoutTx" | "decidedAt">
  >,
): void {
  db.update(submissions).set(patch).where(eq(submissions.id, id)).run();
}

/**
 * Compare-and-set a submission's status ATOMICALLY: transitions only from the
 * exact `from` state (WHERE status = from), stamping `decidedAt` = now so a
 * crash mid-settle leaves a timestamp the sweep can detect. Returns true iff THIS
 * caller won the transition — the autopilot pipeline's concurrency guard so two
 * runners never settle the same submission.
 */
export function casSubmissionStatus(id: string, from: string, to: string): boolean {
  const res = db
    .update(submissions)
    .set({ status: to, decidedAt: nowSeconds() })
    .where(and(eq(submissions.id, id), eq(submissions.status, from)))
    .run();
  return res.changes > 0;
}

/** Recover crashed 'settling' rows (stamped before `staleBeforeSec`) → pending. */
export function resetStaleSettling(staleBeforeSec: number): number {
  const res = db
    .update(submissions)
    .set({ status: "pending", decidedAt: null })
    .where(and(eq(submissions.status, "settling"), lt(submissions.decidedAt, staleBeforeSec)))
    .run();
  return res.changes;
}

/** Pending submissions on autopilot campaigns (the sweep's catch-up target). */
export function listPendingAutopilotSubmissionIds(): string[] {
  return db
    .select({ id: submissions.id })
    .from(submissions)
    .innerJoin(campaigns, eq(submissions.campaignId, campaigns.id))
    .where(and(eq(campaigns.autonomy, "autopilot"), eq(submissions.status, "pending")))
    .all()
    .map((r) => r.id);
}

/** All approved-but-unsettled submissions (the sweep re-fires matured timelocks). */
export function listApprovedSubmissions(): Submission[] {
  return db.select().from(submissions).where(eq(submissions.status, "approved")).all();
}

/**
 * Wallets of every paid submission across all campaigns — the recipients the
 * Deputy has actually paid. Raw (not de-duped) so the pure reputation deriver
 * owns the distinct-count logic; blanks and case are handled there.
 */
export function listPaidRecipientWallets(): string[] {
  return db
    .select({ wallet: submissions.wallet })
    .from(submissions)
    .where(eq(submissions.status, "paid"))
    .all()
    .map((r) => r.wallet);
}

/** Map every settled payout tx (lowercased) to the tester wallet it paid — for the public
 *  payout feed on the landing, so each receipt shows a real recipient. */
export function walletsByPayoutTx(): Map<string, string> {
  const rows = db
    .select({ tx: submissions.payoutTx, wallet: submissions.wallet })
    .from(submissions)
    .where(eq(submissions.status, "paid"))
    .all();
  const m = new Map<string, string>();
  for (const r of rows) if (r.tx) m.set(r.tx.toLowerCase(), r.wallet);
  return m;
}

/* ─────────────────────────────────────────────── deputy decisions ───── */

/** The Deputy's stored verification receipt for a submission, if one exists. */
export function getDecisionBySubmission(submissionId: string): Decision | null {
  return (
    db
      .select()
      .from(decisions)
      .where(eq(decisions.submissionId, submissionId))
      .get() ?? null
  );
}

/** Remove a decision (the sweep's transient-retry deletes then recomputes). */
export function deleteDecision(submissionId: string): void {
  db.delete(decisions).where(eq(decisions.submissionId, submissionId)).run();
}

/** P16 — persist the observation SHADOW record (counts + scalars only) on this submission's decision. */
export function setObservationShadow(submissionId: string, shadow: Record<string, unknown>): void {
  db.update(decisions).set({ observationShadow: shadow }).where(eq(decisions.submissionId, submissionId)).run();
}

/**
 * Persist a decision receipt. Idempotent by the unique submissionId — a race
 * (submit-time compute + a lazy view) resolves to one row, not a crash.
 * `inserted` tells the caller whether THIS write won, so the journal event is
 * emitted exactly once.
 */
export function insertDecision(
  input: Omit<NewDecision, "id" | "createdAt"> & { createdAt?: number },
): { row: Decision | null; inserted: boolean } {
  const id = nanoid(12);
  try {
    db.insert(decisions)
      .values({ ...input, id, createdAt: input.createdAt ?? nowSeconds() })
      .run();
    return { row: getDecisionBySubmission(input.submissionId), inserted: true };
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (!msg.includes("decisions_submission_unq") && !msg.includes("UNIQUE")) {
      throw err;
    }
    // lost the race — the other writer's row stands.
    return { row: getDecisionBySubmission(input.submissionId), inserted: false };
  }
}

/** Every stored decision receipt — the reputation's decision-stats input. */
export function listAllDecisions(): Decision[] {
  // Exclude sandbox campaigns (the public jailbreak box) so red-team attempts can
  // never inflate the Deputy's reputation stats.
  return db
    .select()
    .from(decisions)
    .where(
      notInArray(
        decisions.campaignId,
        db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.sandbox, true)),
      ),
    )
    .all();
}

/** A recent decision joined to its campaign title (non-sensitive summary only). */
export interface RecentDecisionRow {
  campaignTitle: string;
  brief: DecisionBriefContent;
  engine: string;
  createdAt: number;
}

/**
 * Recent decision receipts joined to their campaign title, newest first — the
 * public agent page's "recent reviews". Only the campaign title, recommendation,
 * and confidence surface; the evidence and wallet stay out of the public view.
 */
export function listRecentDecisions(limit = 10): RecentDecisionRow[] {
  return db
    .select({
      campaignTitle: campaigns.title,
      brief: decisions.brief,
      engine: decisions.engine,
      createdAt: decisions.createdAt,
    })
    .from(decisions)
    .innerJoin(campaigns, eq(decisions.campaignId, campaigns.id))
    .where(eq(campaigns.sandbox, false)) // never surface sandbox (jailbreak) reviews
    .orderBy(desc(decisions.createdAt))
    .limit(limit)
    .all();
}

/** The featured receipt for the landing "Watch it think" act. */
export interface StarReceipt {
  decision: Decision;
  rewardBase: number;
  payoutTx: string;
  threshold: number;
}

/**
 * The best REAL settled decision to feature on the landing. Prefers an LLM "pay"
 * receipt, then any LLM receipt, then whichever real settled receipt exists; null
 * if none. Never fabricated — it upgrades itself the moment a mainnet LLM decision
 * settles. Sandbox (jailbreak) campaigns are excluded so a red-team attempt can
 * never headline.
 */
export function getStarReceipt(): StarReceipt | null {
  const rows = db
    .select({
      decision: decisions,
      rewardBase: campaigns.rewardAmount,
      threshold: campaigns.autopilotThreshold,
      payoutTx: submissions.payoutTx,
    })
    .from(decisions)
    .innerJoin(submissions, eq(decisions.submissionId, submissions.id))
    .innerJoin(campaigns, eq(decisions.campaignId, campaigns.id))
    .where(
      // A recorded payout tx == a real on-chain settlement (status is "paid").
      and(isNotNull(submissions.payoutTx), eq(campaigns.sandbox, false)),
    )
    .orderBy(desc(decisions.createdAt))
    .all();

  if (rows.length === 0) return null;
  const chosen =
    rows.find(
      (r) => r.decision.engine === "llm" && r.decision.brief.recommendation === "pay",
    ) ??
    rows.find((r) => r.decision.engine === "llm") ??
    rows[0];
  return {
    decision: chosen.decision,
    rewardBase: chosen.rewardBase,
    payoutTx: chosen.payoutTx as string,
    threshold: chosen.threshold,
  };
}

/**
 * Already-paid (or settling) entries on a campaign + their evidence hash, for the
 * Sybil dedup pre-check. Excludes the submission being evaluated. (The pipeline
 * bails on sandbox campaigns long before this is ever called.)
 */
export function listPaidSubmissionsForDedup(
  campaignId: string,
  excludeSubmissionId: string,
): { note: string | null; contentSha256: string | null }[] {
  return db
    .select({
      note: submissions.note,
      contentSha256: decisions.contentSha256,
    })
    .from(submissions)
    .leftJoin(decisions, eq(decisions.submissionId, submissions.id))
    .where(
      and(
        eq(submissions.campaignId, campaignId),
        inArray(submissions.status, ["paid", "settling"]),
        ne(submissions.id, excludeSubmissionId),
      ),
    )
    .all();
}

/**
 * Every OTHER submission's report text on a campaign (any status except draft) — the corpus the P18
 * near-duplicate detector scans for multi-wallet paraphrase farming. Unlike the exact-match dedup
 * (paid only), farming shows up as a cluster of near-identical PENDING submissions, so we compare
 * against all of them, not just what's already settled.
 */
export function listSubmissionsForDedup(
  campaignId: string,
  excludeSubmissionId: string,
): { note: string | null; contentSha256: string | null }[] {
  return db
    .select({
      note: submissions.note,
      contentSha256: decisions.contentSha256,
    })
    .from(submissions)
    .leftJoin(decisions, eq(decisions.submissionId, submissions.id))
    .where(
      and(
        eq(submissions.campaignId, campaignId),
        ne(submissions.status, "draft"),
        ne(submissions.id, excludeSubmissionId),
      ),
    )
    .all();
}

/* ─────────────────────────────────────────── missions (campaign_v2) ────── */

/**
 * Create one mission row for a campaign_v2 campaign. `missionIdHash`, `rewardAmount`
 * and `maxCompletions` must already mirror the immutable on-chain mission (computed
 * via mission-plan.ts). Legacy (policy_v1) campaigns never have missions.
 */
export function createMission(
  input: Omit<NewMission, "id" | "createdAt" | "updatedAt">,
): Mission {
  const id = nanoid(12);
  const now = nowSeconds();
  db.insert(missions)
    .values({ ...input, id, createdAt: now, updatedAt: now })
    .run();
  return getMissionById(id) as Mission;
}

export function getMissionById(id: string): Mission | null {
  return db.select().from(missions).where(eq(missions.id, id)).get() ?? null;
}

/**
 * Resolve the mission a submission targets — scoped to its campaign by BOTH the
 * campaignId and the bytes32 missionIdHash. Returns null when the campaign has no
 * such mission, so a submission can never be settled against a mission the founder
 * never approved (the reward is only ever the agreed on-chain mission's).
 */
export function getMissionByHash(
  campaignId: string,
  missionIdHash: string,
): Mission | null {
  return (
    db
      .select()
      .from(missions)
      .where(and(eq(missions.campaignId, campaignId), eq(missions.missionIdHash, missionIdHash)))
      .get() ?? null
  );
}

/** Every mission of a campaign, in display order — the full approved plan. */
export function listMissions(campaignId: string): Mission[] {
  return db
    .select()
    .from(missions)
    .where(eq(missions.campaignId, campaignId))
    .orderBy(missions.displayOrder)
    .all();
}

/** Resolve a mission by its stable public key within a campaign. */
export function getMissionByKey(campaignId: string, missionKey: string): Mission | null {
  return (
    db
      .select()
      .from(missions)
      .where(and(eq(missions.campaignId, campaignId), eq(missions.missionKey, missionKey)))
      .get() ?? null
  );
}

/** Build the MissionSpecV1 input from a mission row + its campaign identity hash. */
export function missionSpecInput(
  mission: Mission,
  campaignIdHash: string,
): MissionSpecInput {
  return {
    campaignIdHash: campaignIdHash as `0x${string}`,
    missionIdHash: mission.missionIdHash as `0x${string}`,
    title: mission.title,
    objective: mission.objective,
    instructions: mission.instructions,
    targetSurface: mission.targetSurface,
    criteria: mission.criteria,
    evidenceRequirements: mission.evidenceList,
    rewardBase: BigInt(mission.rewardAmount),
    maxCompletions: BigInt(mission.maxCompletions),
  };
}

/** Recompute the canonical MissionSpecV1 digest for a mission row (pure). */
export function recomputeMissionSpecDigest(mission: Mission, campaignIdHash: string): string {
  return missionSpecDigest(missionSpecInput(mission, campaignIdHash));
}

/**
 * Edit a DRAFT mission's fields. Only permitted while status = 'draft' (before the
 * plan is locked to a vault); once locked, economics + prose are immutable and a
 * material change must become a NEW mission revision. Returns false if not editable.
 */
export function updateMissionDraft(
  id: string,
  patch: Partial<
    Pick<
      Mission,
      | "title"
      | "objective"
      | "instructions"
      | "targetSurface"
      | "criteria"
      | "evidenceList"
      | "rewardAmount"
      | "maxCompletions"
      | "displayOrder"
    >
  >,
): boolean {
  const row = getMissionById(id);
  if (!row || row.status !== "draft") return false;
  db.update(missions)
    .set({ ...patch, updatedAt: nowSeconds() })
    .where(and(eq(missions.id, id), eq(missions.status, "draft")))
    .run();
  return true;
}

/** Reorder a mission (presentation only) — allowed in any non-closed lifecycle. */
export function updateMissionOrder(id: string, displayOrder: number): void {
  db.update(missions)
    .set({ displayOrder, updatedAt: nowSeconds() })
    .where(eq(missions.id, id))
    .run();
}

/**
 * Lock a campaign's mission plan: for every DRAFT mission, compute + freeze its
 * MissionSpecV1 digest, stamp `lockedAt`, and move it to 'active'. After this the
 * economics (reward, cap, id hashes) are immutable — the setup flow only locks once
 * the DB↔chain agreement has passed. Idempotent (already-active missions are skipped).
 */
export function lockMissionPlan(campaignId: string, campaignIdHash: string): number {
  const now = nowSeconds();
  let locked = 0;
  for (const m of listMissions(campaignId)) {
    if (m.status !== "draft") continue;
    db.update(missions)
      .set({
        status: "active",
        lockedAt: now,
        specDigest: recomputeMissionSpecDigest(m, campaignIdHash),
        updatedAt: now,
      })
      .where(and(eq(missions.id, m.id), eq(missions.status, "draft")))
      .run();
    locked += 1;
  }
  return locked;
}

/** Close a mission (terminal). */
export function closeMission(id: string): void {
  db.update(missions)
    .set({ status: "closed", closedAt: nowSeconds(), updatedAt: nowSeconds() })
    .where(eq(missions.id, id))
    .run();
}

/** Paid completions so far for a mission — read from real paid submissions. */
export function countPaidForMission(missionIdHash: string): number {
  return db
    .select({ id: submissions.id })
    .from(submissions)
    .where(and(eq(submissions.missionIdHash, missionIdHash), eq(submissions.status, "paid")))
    .all().length;
}

/** How many times this wallet has submitted to this campaign since `sinceUnix` (P18 per-wallet daily
 *  submission limit — DB-backed so it survives a process restart, unlike the in-memory burst limiter). */
export function countRecentSubmissionsByWallet(
  campaignId: string,
  wallet: string,
  sinceUnix: number,
): number {
  return db
    .select({ id: submissions.id })
    .from(submissions)
    .where(
      and(
        eq(submissions.campaignId, campaignId),
        eq(submissions.wallet, wallet),
        gte(submissions.createdAt, sinceUnix),
      ),
    )
    .all().length;
}

/** How many times this wallet has ALREADY been paid (or is mid-settlement) across this whole campaign —
 *  the P18 founder-set per-campaign per-wallet payout cap is enforced against this in preflight. Counts
 *  `settling` too so a concurrent settle can't slip a wallet past its cap. */
export function countPaidByWalletInCampaign(campaignId: string, wallet: string): number {
  return db
    .select({ id: submissions.id })
    .from(submissions)
    .where(
      and(
        eq(submissions.campaignId, campaignId),
        eq(submissions.wallet, wallet),
        inArray(submissions.status, ["paid", "settling"]),
      ),
    )
    .all().length;
}

/* ──────────────────────────────────────────── operator fees (x402) ────── */

/**
 * Record a pending operator fee for a settled payout — idempotent by settleTx.
 * Returns true only when a NEW row was inserted (so the journal fires once).
 */
export function recordPendingFee(input: {
  settleTx: string;
  campaignId?: string | null;
  submissionId?: string | null;
  amountBase: number;
}): boolean {
  const id = nanoid(12);
  try {
    db.insert(fees)
      .values({
        id,
        settleTx: input.settleTx,
        campaignId: input.campaignId ?? null,
        submissionId: input.submissionId ?? null,
        amountBase: input.amountBase,
        status: "pending",
        createdAt: nowSeconds(),
      })
      .run();
    return true;
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (!msg.includes("fees_settle_unq") && !msg.includes("UNIQUE")) throw err;
    return false; // already recorded — idempotent, not an error.
  }
}

export function listPendingFees(): Fee[] {
  return db.select().from(fees).where(eq(fees.status, "pending")).all();
}

/** Total operator fees actually collected (status 'settled'), in USDC base units. */
export function sumSettledFeesBase(): number {
  return db
    .select({ amountBase: fees.amountBase })
    .from(fees)
    .where(eq(fees.status, "settled"))
    .all()
    .reduce((s, r) => s + r.amountBase, 0);
}

export function getFeeBySettleTx(settleTx: string): Fee | null {
  return db.select().from(fees).where(eq(fees.settleTx, settleTx)).get() ?? null;
}

export function markFeeSettled(id: string, paymentTx: string, orderId: string): void {
  db.update(fees)
    .set({ status: "settled", paymentTx, orderId })
    .where(eq(fees.id, id))
    .run();
}

/** Aggregate fee state for the Wallet / Proof surfaces (real settled txs only). */
export function feeTotals(): {
  paidCount: number;
  paidBase: number;
  pendingCount: number;
} {
  const all = db.select().from(fees).all();
  let paidCount = 0;
  let paidBase = 0;
  let pendingCount = 0;
  for (const f of all) {
    if (f.status === "settled") {
      paidCount += 1;
      paidBase += f.amountBase;
    } else {
      pendingCount += 1;
    }
  }
  return { paidCount, paidBase, pendingCount };
}

/* ───────────────────────────────────────────────── events (journal) ───── */

/** Append one real event to the journal. Called at the moment the action occurs. */
export function recordEvent(
  input: Omit<NewCampaignEvent, "id" | "createdAt"> & { createdAt?: number },
): CampaignEvent {
  const id = nanoid(12);
  const row: NewCampaignEvent = {
    ...input,
    id,
    createdAt: input.createdAt ?? nowSeconds(),
  };
  db.insert(events).values(row).run();
  return db.select().from(events).where(eq(events.id, id)).get() as CampaignEvent;
}

/**
 * Record an app event that is DURABLY idempotent by (kind, txHash) — the economic
 * settlement journal (settled / autopay_settled). A payout tx settles at most once
 * on-chain, so its journal row is keyed by its tx hash: a recovery that re-applies
 * downstream effects re-runs this, but the second call is a no-op. Returns `inserted`
 * so the caller can gate anything that must happen exactly once. (Chain-reconciled
 * vendor events carry a real log index and use their own dedupe, never this.)
 */
export function recordEventOnce(
  input: Omit<NewCampaignEvent, "id" | "createdAt"> & { createdAt?: number },
): { event: CampaignEvent; inserted: boolean } {
  if (input.txHash) {
    const existing = db
      .select()
      .from(events)
      .where(and(eq(events.kind, input.kind), eq(events.txHash, input.txHash)))
      .limit(1)
      .get();
    if (existing) return { event: existing, inserted: false };
  }
  return { event: recordEvent(input), inserted: true };
}

/** A campaign's events, newest first. */
export function listCampaignEvents(campaignId: string): CampaignEvent[] {
  return db
    .select()
    .from(events)
    .where(eq(events.campaignId, campaignId))
    .orderBy(desc(events.createdAt))
    .all();
}

/** Recent journal events across all NON-sandbox campaigns, newest first — the ticker. */
export function listRecentEvents(limit = 24): CampaignEvent[] {
  return db
    .select()
    .from(events)
    .where(
      notInArray(
        events.campaignId,
        db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.sandbox, true)),
      ),
    )
    .orderBy(desc(events.createdAt))
    .limit(limit)
    .all();
}

/**
 * Global journal slice by kind (e.g. settled / autopay_settled / blocked),
 * newest first — the chain-reconciled raw material for the agent's grounded
 * reputation across ALL campaigns. Optional cap for the "recent receipts" view.
 */
export function listEventsByKinds(
  kinds: EventKind[],
  limit?: number,
): CampaignEvent[] {
  if (kinds.length === 0) return [];
  const q = db
    .select()
    .from(events)
    .where(inArray(events.kind, kinds))
    .orderBy(desc(events.createdAt));
  return (limit ? q.limit(limit) : q).all();
}

/**
 * Insert a chain-derived event, idempotent by (txHash, logIndex) via the
 * events_chain_unq index. Returns true when a new row landed, false on a
 * duplicate — so the reconciler can re-scan the same blocks harmlessly.
 */
export function recordChainEvent(
  input: Omit<NewCampaignEvent, "id" | "createdAt"> & { createdAt: number },
): boolean {
  const id = nanoid(12);
  try {
    db.insert(events).values({ ...input, id }).run();
    return true;
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes("events_chain_unq") || msg.includes("UNIQUE")) return false;
    throw err;
  }
}

/** The last block whose vendor events are folded into the journal for a vault. */
export function getVaultCursor(vault: string): number {
  const row = db
    .select()
    .from(vaultCursors)
    .where(eq(vaultCursors.vaultAddress, vault.toLowerCase()))
    .get();
  return row?.lastBlock ?? 0;
}

export function setVaultCursor(vault: string, lastBlock: number): void {
  db.insert(vaultCursors)
    .values({ vaultAddress: vault.toLowerCase(), lastBlock })
    .onConflictDoUpdate({ target: vaultCursors.vaultAddress, set: { lastBlock } })
    .run();
}

/* ─────────────────────────────────────────────── advisory locks ───────── */

/**
 * Acquire a named lock for `ttlSec`, ATOMICALLY: the upsert only steals the row
 * when the existing holder has expired (the ON CONFLICT UPDATE is gated on
 * expiry). Returns true iff we hold it — the sweep's singleton guard so
 * overlapping ticks don't run the pipeline at the same time.
 */
export function acquireLock(name: string, ttlSec: number): boolean {
  const now = nowSeconds();
  // Clear an expired holder (idempotent), then race to insert. The primary-key
  // unique constraint is the atomic guard: exactly one concurrent insert wins; a
  // still-live lock isn't deleted, so its insert conflicts and we return false.
  db.delete(locks).where(and(eq(locks.name, name), lte(locks.expiresAt, now))).run();
  try {
    db.insert(locks).values({ name, expiresAt: now + ttlSec }).run();
    return true;
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes("UNIQUE") || msg.includes("PRIMARY")) return false;
    throw err;
  }
}

/** Release a lock early (best-effort; it also auto-expires). */
export function releaseLock(name: string): void {
  db.delete(locks).where(eq(locks.name, name)).run();
}

/** Campaigns funded by a given vault (checksummed) — for reconciler journal linking. */
export function getCampaignsByVault(vault: string): Campaign[] {
  return db.select().from(campaigns).where(eq(campaigns.vaultAddress, vault)).all();
}

/** Events across all of a poster's campaigns (the Deputy work journal), newest first. */
export function listPosterEvents(wallet: string, limit = 50): CampaignEvent[] {
  const ids = listCampaigns()
    .filter((c) => c.posterWallet.toLowerCase() === wallet.toLowerCase())
    .map((c) => c.id);
  if (ids.length === 0) return [];
  return db
    .select()
    .from(events)
    .where(inArray(events.campaignId, ids))
    .orderBy(desc(events.createdAt))
    .limit(limit)
    .all();
}

/* ─────────────────────────────────────────────────────── demo seed ────── */

/**
 * Sage's own first REAL campaign (kept under the stable `demo` slug so
 * /c/demo never orphans). It's genuine dogfood: real task, real submissions,
 * real payouts from the Sage-owned vault — this is the link we drop in the
 * cohort chat. Idempotent, and renames the old seed in place (same row + slug,
 * submissions preserved) so existing databases upgrade on next load.
 */
const TESTER_CRITERIA = [
  "Named a specific part of Sage you actually tried (the jailbreak box, the app, or a proof page)",
  "One concrete, specific detail — what you did and what happened, not generic praise",
] as const;

const FLAGSHIP_TESTNET = {
  title: "Break the Deputy — founding testers (testnet)",
  descriptionMd:
    "Try to jailbreak the Deputy in the box on its agent page — or just click through the app — then tell us the one specific thing you found: what you tried and what happened. Genuine, specific reports are paid test USDC on Metis Sepolia (the mainnet flow is identical, with real USDC); vague or spammy ones get held. Paste a screenshot link if you have one — optional.",
  criteria: TESTER_CRITERIA,
} as const;

const FLAGSHIP_MAINNET = {
  title: "Break the Deputy — paid in real USDC",
  descriptionMd:
    "Try to jailbreak the Deputy in the box on its agent page — or just click through the app — then tell us the one specific thing you found: what you tried and what happened. Genuine, specific reports get paid real USDC on GOAT mainnet, released by the autonomous Deputy from a policy-capped on-chain vault; vague or spammy ones get held. Paste a screenshot link if you have one — optional. The agent verifies your report and the vault enforces every limit on-chain.",
  criteria: TESTER_CRITERIA,
} as const;

/** Reward per accepted tester, in USDC base units (6dp). Mainnet reads env. */
function dogfoodRewardBase(mainnet: boolean): number {
  if (!mainnet) return 10_000_000; // $10 test USDC
  const usdc = Number(process.env.GOAT_DOGFOOD_REWARD_USDC ?? "0.5");
  return Math.round((Number.isFinite(usdc) && usdc > 0 ? usdc : 0.5) * 1_000_000);
}

/**
 * Sage's own dogfood campaign (stable `demo` slug so /c/demo never orphans).
 * NETWORK-AWARE: once GOAT_VAULT_ADDRESS is deployed, the dogfood flips to GOAT
 * mainnet (chainId 2345, real USDC to real wallets); until then it runs on the
 * Metis Sepolia testnet vault. Founder onboarding stays a Sepolia "testnet
 * playground" regardless — only THIS campaign moves real money. Idempotent, and
 * it upgrades the row in place when the network config changes.
 */
/** The flagship campaign's production slug — used in /c/<slug> and the redirect. */
export const FLAGSHIP_CAMPAIGN_ID = "founding-testers";

export function ensureFlagshipCampaign(): void {
  const goatVault = process.env.GOAT_VAULT_ADDRESS?.trim();
  const sepoliaVault = process.env.NEXT_PUBLIC_VAULT_ADDRESS?.trim();
  const mainnet = !!goatVault;
  const vault = mainnet ? goatVault : sepoliaVault;
  if (!vault) return;

  const chainId = mainnet ? 2345 : 59902;
  const spec = mainnet ? FLAGSHIP_MAINNET : FLAGSHIP_TESTNET;
  const reward = dogfoodRewardBase(mainnet);
  // Seats the vault can truly fund, so nothing overpromises (override with
  // GOAT_DOGFOOD_SEATS if the vault is resized).
  const seats = mainnet ? Number(process.env.GOAT_DOGFOOD_SEATS ?? "4") : 25;
  // Mainnet runs on AUTOPILOT (the red-teamed brain auto-pays confident, clean
  // matches). DEPUTY_AUTOPILOT_MAINNET still gates real-money autopilot.
  const autonomy: "manual" | "autopilot" = mainnet ? "autopilot" : "manual";
  const announceChatId = process.env.TELEGRAM_ANNOUNCE_CHAT_ID?.trim() || null;
  const poster =
    (mainnet
      ? process.env.ERC8004_AGENT_ADDRESS
      : process.env.NEXT_PUBLIC_OPERATOR_ADDRESS) ?? vault;

  // Retire the legacy `demo` row (production naming): close it so it stops
  // soliciting. The /c/demo → /c/founding-testers redirect keeps shared links
  // alive, and its history still counts in /agents aggregates (reputation reads
  // every journal row, not just the current campaign).
  const legacy = getCampaign("demo");
  if (legacy && legacy.status !== "completed") {
    db.update(campaigns).set({ status: "completed" }).where(eq(campaigns.id, "demo")).run();
  }

  const fields = {
    title: spec.title,
    descriptionMd: spec.descriptionMd,
    criteria: [...spec.criteria],
    chainId,
    vaultAddress: vault,
    rewardAmount: reward,
    maxRecipients: seats,
    autonomy,
    autopilotThreshold: 0.85,
    posterWallet: poster,
    ownerIsSage: true,
    announceChatId,
  };

  const existing = getCampaign(FLAGSHIP_CAMPAIGN_ID);
  if (existing) {
    const drift =
      existing.title !== spec.title ||
      existing.descriptionMd !== spec.descriptionMd ||
      JSON.stringify(existing.criteria) !== JSON.stringify(spec.criteria) ||
      existing.chainId !== chainId ||
      existing.vaultAddress.toLowerCase() !== vault.toLowerCase() ||
      existing.rewardAmount !== reward ||
      existing.maxRecipients !== seats ||
      existing.autonomy !== autonomy ||
      existing.announceChatId !== announceChatId ||
      existing.status !== "live";
    if (drift) {
      db.update(campaigns)
        .set({ ...fields, status: "live" })
        .where(eq(campaigns.id, FLAGSHIP_CAMPAIGN_ID))
        .run();
    }
    return;
  }

  db.insert(campaigns)
    .values({
      id: FLAGSHIP_CAMPAIGN_ID,
      conditionType: "approval",
      onchainCheck: null,
      status: "live",
      createdAt: nowSeconds(),
      ...fields,
    })
    .run();
}
