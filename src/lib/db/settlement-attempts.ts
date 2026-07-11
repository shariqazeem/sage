import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Hash } from "viem";

import { db } from "./index";
import { nowSeconds } from "./keys";
import {
  settlementAttempts,
  type SettlementAttempt,
  type VaultKind,
} from "./schema";

/**
 * The durable settlement-attempt ledger — the app-side twin of the vault's
 * on-chain replay guard (check 7). The chain guarantees a payout intent settles
 * AT MOST once; this table guarantees we always LEARN which way an attempt went,
 * even across a crash between broadcasting the tx and reading its receipt.
 *
 * The contract with the settle path is:
 *   1. `prepareAttempt` — write the intent row BEFORE anything is broadcast.
 *   2. `markBroadcast(hash)` — persist the txHash the instant the tx is sent,
 *      before waiting for the receipt (this is the crash-critical write).
 *   3. `markSettled` / `markRejected` — record the decoded on-chain outcome.
 *   4. On resume, `planResume(getAttempt(...))` decides the next move from the
 *      persisted state — never a blind re-broadcast.
 *
 * `import "server-only"` is aliased to a no-op under vitest, so this module is
 * exercised directly against an in-memory SQLite (SAGE_DB_PATH=":memory:").
 */

export interface PrepareAttemptInput {
  /** The vault's replay-protected intent hash — the unique key. */
  payoutIntentHash: string;
  /** The decision digest this intent was derived from, or null for a legacy intent. */
  decisionDigest: string | null;
  submissionId: string;
  campaignId: string;
  chainId: number;
  vaultAddress: string;
  recipient: string;
  amountBase: number;
  /** Commitment version this attempt settles under (1 = V1 policy, 2 = V2 campaign). Default 1. */
  commitmentVersion?: number;
  /** V2: the mission (bytes32 hex) this payout targets, else null. */
  missionIdHash?: string | null;
  /** The vault kind this attempt settles against. Default policy_v1. */
  vaultKind?: VaultKind;
}

export function getAttempt(payoutIntentHash: string): SettlementAttempt | null {
  const rows = db
    .select()
    .from(settlementAttempts)
    .where(eq(settlementAttempts.payoutIntentHash, payoutIntentHash))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

/**
 * Find the durable attempt for a broadcast tx hash — the join the proof composer
 * uses to check whether an on-chain payout came through the decision-committed
 * path and whether the stored intent matches the chain.
 */
export function getAttemptByTx(txHash: string): SettlementAttempt | null {
  const rows = db
    .select()
    .from(settlementAttempts)
    .where(eq(settlementAttempts.txHash, txHash))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

/**
 * Get-or-create the single attempt row for a payout intent. Idempotent by the
 * unique payout_intent_hash: a resumed flow (crash, double-trigger, retry) finds
 * the EXISTING row instead of creating a second — so there is always exactly one
 * attempt per intent. `created` is true only for the caller whose insert won the
 * race (compared by the id it generated), so a concurrent double-trigger has a
 * single winner.
 */
export function prepareAttempt(
  input: PrepareAttemptInput,
): { attempt: SettlementAttempt; created: boolean } {
  const id = nanoid();
  const now = nowSeconds();
  db.insert(settlementAttempts)
    .values({
      id,
      payoutIntentHash: input.payoutIntentHash,
      decisionDigest: input.decisionDigest,
      commitmentVersion: input.commitmentVersion ?? 1,
      missionIdHash: input.missionIdHash ?? null,
      vaultKind: input.vaultKind ?? "policy_v1",
      submissionId: input.submissionId,
      campaignId: input.campaignId,
      chainId: input.chainId,
      vaultAddress: input.vaultAddress,
      recipient: input.recipient,
      amountBase: input.amountBase,
      status: "prepared",
      txHash: null,
      failedCheckIndex: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: settlementAttempts.payoutIntentHash })
    .run();

  const attempt = getAttempt(input.payoutIntentHash);
  if (!attempt) {
    throw new Error(
      `prepareAttempt: row for intent ${input.payoutIntentHash} vanished after insert`,
    );
  }
  return { attempt, created: attempt.id === id };
}

/**
 * Persist the broadcast IDENTITY (sender, reserved nonce, calldata hash) the instant
 * we are about to submit a tx — BEFORE the RPC can accept it. This is the durable
 * fact "a transaction may now be in flight for this intent." A crash after this and
 * before {@link markBroadcast} leaves an AMBIGUOUS `broadcasting` attempt that
 * recovery reconciles from the chain — it NEVER blind-resends, because a used nonce
 * proves a tx was accepted. Only V2 uses this; V1 attempts never enter this state.
 */
export function markBroadcasting(
  payoutIntentHash: string,
  meta: { senderAddress: string; nonce: number | null; calldataHash: string },
): void {
  db.update(settlementAttempts)
    .set({
      status: "broadcasting",
      senderAddress: meta.senderAddress,
      broadcastNonce: meta.nonce,
      calldataHash: meta.calldataHash,
      broadcastAt: nowSeconds(),
      updatedAt: nowSeconds(),
    })
    .where(eq(settlementAttempts.payoutIntentHash, payoutIntentHash))
    .run();
}

/**
 * Persist the broadcast tx hash the instant the tx is sent — the single most
 * important write for crash recovery. After this returns, a crash before the
 * receipt is fully recoverable: the txHash is on disk and `planResume` will read
 * that tx instead of re-sending.
 */
export function markBroadcast(payoutIntentHash: string, txHash: Hash): void {
  db.update(settlementAttempts)
    .set({ status: "broadcast", txHash, updatedAt: nowSeconds() })
    .where(eq(settlementAttempts.payoutIntentHash, payoutIntentHash))
    .run();
}

export function markSettled(payoutIntentHash: string, txHash: Hash): void {
  db.update(settlementAttempts)
    .set({ status: "settled", txHash, failedCheckIndex: null, updatedAt: nowSeconds() })
    .where(eq(settlementAttempts.payoutIntentHash, payoutIntentHash))
    .run();
}

export function markRejected(
  payoutIntentHash: string,
  txHash: Hash,
  failedCheckIndex: number | null,
): void {
  db.update(settlementAttempts)
    .set({ status: "rejected", txHash, failedCheckIndex, updatedAt: nowSeconds() })
    .where(eq(settlementAttempts.payoutIntentHash, payoutIntentHash))
    .run();
}

/**
 * Record an unexpected failure (RPC error, revert). NOT terminal: a failed
 * attempt is resumed by verifying `isIntentUsed` on-chain first — the tx may have
 * landed despite the error — and only then re-broadcasting if it truly did not.
 */
export function markFailed(payoutIntentHash: string, error: string): void {
  db.update(settlementAttempts)
    .set({ status: "failed", lastError: error.slice(0, 500), updatedAt: nowSeconds() })
    .where(eq(settlementAttempts.payoutIntentHash, payoutIntentHash))
    .run();
}

/* ───────────────────────────────────────────── resume planning (pure) ──── */

/**
 * What to do next for a payout intent, given its durable attempt row. PURE — it
 * reads only the row, so the crash-recovery decision is unit-testable without a
 * chain or a database. The whole point: from any persisted state, decide the
 * next move WITHOUT ever blind-resending a tx that may already have settled.
 */
export type ResumeAction =
  | { kind: "broadcast" } // never signed/sent — safe to send a fresh tx
  | { kind: "reconcile_broadcast" } // a tx MAY be in flight — reconcile by chain, NEVER blind-resend
  | { kind: "await"; txHash: Hash } // sent, outcome unknown — read this tx's receipt
  | { kind: "verify"; txHash: Hash | null } // anomalous/errored — check isIntentUsed BEFORE any resend
  | { kind: "settled"; txHash: Hash | null } // already paid — never resend
  | { kind: "rejected"; txHash: Hash | null; failedCheckIndex: number | null }; // already blocked

const asHash = (s: string | null): Hash | null => (s ? (s as Hash) : null);

export function planResume(attempt: SettlementAttempt | null): ResumeAction {
  if (!attempt) return { kind: "broadcast" };
  switch (attempt.status) {
    case "prepared":
      // A txHash on a still-"prepared" row means a broadcast raced ahead of its
      // status write — treat it as sent and read the receipt, never re-send.
      return attempt.txHash
        ? { kind: "await", txHash: attempt.txHash as Hash }
        : { kind: "broadcast" };
    case "broadcasting":
      // The AMBIGUOUS window: sender+nonce were persisted before submission, so a
      // tx may be in flight. If a hash slipped through, read it; otherwise reconcile
      // from the chain — NEVER blind-resend on isIntentUsed==false alone.
      return attempt.txHash
        ? { kind: "await", txHash: attempt.txHash as Hash }
        : { kind: "reconcile_broadcast" };
    case "broadcast":
      // Broadcast with no txHash is anomalous — verify on-chain, don't re-send.
      return attempt.txHash
        ? { kind: "await", txHash: attempt.txHash as Hash }
        : { kind: "verify", txHash: null };
    case "settled":
      return { kind: "settled", txHash: asHash(attempt.txHash) };
    case "rejected":
      return {
        kind: "rejected",
        txHash: asHash(attempt.txHash),
        failedCheckIndex: attempt.failedCheckIndex,
      };
    case "failed":
      return { kind: "verify", txHash: asHash(attempt.txHash) };
    default: {
      const _exhaustive: never = attempt.status;
      void _exhaustive;
      return { kind: "verify", txHash: asHash(attempt.txHash) };
    }
  }
}
