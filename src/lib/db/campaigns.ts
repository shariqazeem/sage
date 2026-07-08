import "server-only";

import { and, desc, eq, inArray, lt, lte } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./index";
import {
  campaigns,
  decisions,
  events,
  fees,
  locks,
  submissions,
  vaultCursors,
  type Campaign,
  type CampaignEvent,
  type Decision,
  type EventKind,
  type Fee,
  type NewCampaign,
  type NewCampaignEvent,
  type NewDecision,
  type NewSubmission,
  type Submission,
} from "./schema";
import type { DecisionBriefContent } from "../deputy/brain-core";
import { dedupeKey, nowSeconds } from "./keys";

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

export type SubmitResult =
  | { ok: true; submission: Submission }
  | { ok: false; error: "duplicate_wallet" | "duplicate_evidence" | "unknown" };

/** Insert a submission; the DB unique indexes enforce dedupe (surfaced politely). */
export function createSubmission(input: {
  campaignId: string;
  wallet: string;
  evidenceUrl?: string | null;
  note?: string | null;
}): SubmitResult {
  const id = nanoid(12);
  const row: NewSubmission = {
    id,
    campaignId: input.campaignId,
    wallet: input.wallet,
    evidenceUrl: input.evidenceUrl ?? null,
    note: input.note ?? null,
    dedupeKey: dedupeKey(input.campaignId, input.wallet),
    status: "pending",
    createdAt: nowSeconds(),
  };
  try {
    db.insert(submissions).values(row).run();
    return { ok: true, submission: getSubmission(id) as Submission };
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes("sub_dedupe_unq")) return { ok: false, error: "duplicate_wallet" };
    if (msg.includes("sub_evidence_unq")) return { ok: false, error: "duplicate_evidence" };
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
  return db.select().from(decisions).all();
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
    .orderBy(desc(decisions.createdAt))
    .limit(limit)
    .all();
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

/** A campaign's events, newest first. */
export function listCampaignEvents(campaignId: string): CampaignEvent[] {
  return db
    .select()
    .from(events)
    .where(eq(events.campaignId, campaignId))
    .orderBy(desc(events.createdAt))
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
const DOGFOOD_TESTNET = {
  title: "Break Sage's onboarding — get paid",
  descriptionMd:
    "Create your own Deputy vault on Metis Sepolia through the /app onboarding — grab tMETIS from the faucet, test USDC is minted in-flow. Then submit a link to your vault on the explorer (or your created-campaign link) plus a note on anything that confused or broke. Test USDC to testers, from a capped on-chain vault.",
  criteria: [
    "Completed the /app onboarding — vault created and funded",
    "Evidence link resolves (your vault on the explorer, or your campaign)",
    "A genuine note on friction or what broke",
  ],
} as const;

const DOGFOOD_MAINNET = {
  title: "Break Sage's onboarding — paid in real USDC",
  descriptionMd:
    "Real USDC on GOAT mainnet, paid to your real wallet from a policy-capped on-chain vault. Try the /app onboarding (a Metis Sepolia testnet playground — no real funds there), then submit a link to what you built plus an honest note on anything that confused or broke. Accepted testers are paid real USDC on GOAT, released by the Deputy inside its enforced on-chain caps.",
  criteria: [
    "Tried the /app onboarding testnet playground and created a vault",
    "Evidence link resolves (your vault or campaign on an explorer)",
    "A genuine note on friction or what broke",
  ],
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
export function ensureDemoCampaign(): void {
  const goatVault = process.env.GOAT_VAULT_ADDRESS?.trim();
  const sepoliaVault = process.env.NEXT_PUBLIC_VAULT_ADDRESS?.trim();
  const mainnet = !!goatVault;
  const vault = mainnet ? goatVault : sepoliaVault;
  if (!vault) return;

  const chainId = mainnet ? 2345 : 59902;
  const spec = mainnet ? DOGFOOD_MAINNET : DOGFOOD_TESTNET;
  const reward = dogfoodRewardBase(mainnet);
  // Seats the vault can truly fund, so nothing overpromises. Mainnet: the 2-USDC
  // vault at 0.5/tester funds 4 (override with GOAT_DOGFOOD_SEATS if the vault
  // is resized). Testnet: the generous playground default.
  const seats = mainnet ? Number(process.env.GOAT_DOGFOOD_SEATS ?? "4") : 25;
  // The mainnet dogfood runs on AUTOPILOT (the red-teamed brain auto-pays
  // confident, clean matches). The DEPUTY_AUTOPILOT_MAINNET flag still gates
  // whether autopilot moves real money, so this is safe to set declaratively.
  const autonomy: "manual" | "autopilot" = mainnet ? "autopilot" : "manual";
  // Public announce chat for the dogfood, if the operator wired one (outbound only).
  const announceChatId = process.env.TELEGRAM_ANNOUNCE_CHAT_ID?.trim() || null;
  const poster =
    (mainnet
      ? process.env.ERC8004_AGENT_ADDRESS
      : process.env.NEXT_PUBLIC_OPERATOR_ADDRESS) ?? vault;

  const existing = getCampaign("demo");
  if (existing) {
    const drift =
      existing.title !== spec.title ||
      existing.chainId !== chainId ||
      existing.vaultAddress.toLowerCase() !== vault.toLowerCase() ||
      existing.rewardAmount !== reward ||
      existing.maxRecipients !== seats ||
      existing.autonomy !== autonomy ||
      existing.announceChatId !== announceChatId;
    if (drift) {
      db.update(campaigns)
        .set({
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
        })
        .where(eq(campaigns.id, "demo"))
        .run();
    }
    return;
  }

  db.insert(campaigns)
    .values({
      id: "demo",
      title: spec.title,
      descriptionMd: spec.descriptionMd,
      criteria: [...spec.criteria],
      conditionType: "approval",
      onchainCheck: null,
      rewardAmount: reward,
      maxRecipients: seats,
      vaultAddress: vault,
      chainId,
      autonomy,
      autopilotThreshold: 0.85,
      posterWallet: poster,
      ownerIsSage: true,
      status: "live",
      announceChatId,
      createdAt: nowSeconds(),
    })
    .run();
}
