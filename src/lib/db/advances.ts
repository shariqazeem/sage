import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { advanceFeeTopups, advances, advanceRepayments, type AdvanceRow } from "@/lib/db/schema";
import { founderStorageKey } from "@/lib/auth/founder";
import { WATERFALL_BPS_MAX } from "@/lib/advance/waterfall";

/**
 * The advances ledger. Every mutation here is bounded by the schema's own guards — one active
 * advance per borrower (partial unique index), one repayment per payout (unique submission) — so
 * a bug in a caller degrades to a thrown constraint, never to doubled money.
 */

const now = () => Math.floor(Date.now() / 1000);
const rid = () => `adv-${crypto.randomUUID().slice(0, 12)}`;

export interface CreateAdvanceInput {
  borrowerWallet: string;
  principalBase: bigint;
  /** the LENDER'S multiple — recorded for the published arithmetic, never Sage's judgement. */
  multiple: number;
  waterfallBps: number;
  potAddress: string;
  /** the rail it lives on: Metis (1088) for every new advance since 26 Oct 2026. */
  chainId: number;
}

export function createAdvance(input: CreateAdvanceInput): AdvanceRow {
  if (input.principalBase <= BigInt(0)) throw new Error("an advance must be a positive amount");
  if (
    !Number.isInteger(input.waterfallBps) ||
    input.waterfallBps <= 0 ||
    input.waterfallBps > WATERFALL_BPS_MAX
  ) {
    throw new Error(`waterfallBps out of range: ${input.waterfallBps}`);
  }
  const row = {
    id: rid(),
    borrowerWallet: founderStorageKey(input.borrowerWallet),
    principalBase: Number(input.principalBase),
    multiple: input.multiple,
    waterfallBps: input.waterfallBps,
    potAddress: input.potAddress,
    status: "active" as const,
    outstandingBase: Number(input.principalBase),
    disburseTx: null,
    disburseClaimCommitment: null,
    disburseClaimSecret: null,
    createdAt: now(),
    repaidAt: null,
    chainId: input.chainId,
  };
  db.insert(advances).values(row).run();
  return row;
}

/** Remove an advance whose disbursement provably moved nothing (never sent, or reverted). */
export function voidUndisbursedAdvance(advanceId: string): void {
  db.delete(advances).where(eq(advances.id, advanceId)).run();
}

/** Every active advance on one rail, oldest first: what the collector services. */
export function listActiveAdvancesOn(chainId: number): AdvanceRow[] {
  return db
    .select()
    .from(advances)
    .where(and(eq(advances.status, "active"), eq(advances.chainId, chainId)))
    .all()
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** The submissions already considered for an advance's repayment (collected or missed), once each. */
export function consideredSubmissions(advanceId: string): Set<string> {
  return new Set(
    db.select({ id: advanceRepayments.submissionId }).from(advanceRepayments).where(eq(advanceRepayments.advanceId, advanceId)).all().map((r) => r.id),
  );
}

/** The one advance the waterfall must service for this earner, if any. Chain-agnostic key. */
export function getActiveAdvance(wallet: string): AdvanceRow | null {
  const key = founderStorageKey(wallet);
  const row = db
    .select()
    .from(advances)
    .where(and(eq(advances.borrowerWallet, key), eq(advances.status, "active")))
    .get();
  return row ?? null;
}

/** The disbursement's transaction, written the moment it is sent (Metis), or the escrow's claim (Starknet). */
export function recordDisbursement(
  advanceId: string,
  d: { tx: string; claimCommitment?: string | null; claimSecret?: string | null },
): void {
  db.update(advances)
    .set({ disburseTx: d.tx, disburseClaimCommitment: d.claimCommitment ?? null, disburseClaimSecret: d.claimSecret ?? null })
    .where(eq(advances.id, advanceId))
    .run();
}

export interface RepaymentInput {
  advanceId: string;
  submissionId: string;
  amountBase: bigint;
  /** the transaction that moved the slice: an escrow on Starknet, the pot's transferFrom on Metis. */
  escrowTx: string;
  /** Starknet only: the pot's claim leg. */
  claimCommitment?: string | null;
  claimSecret?: string | null;
}

/**
 * Record one waterfall slice, atomically with the balance it pays down.
 *
 * The decrement is guarded (`outstanding - amount >= 0` enforced in code, uniqueness in schema):
 * a repayment larger than the balance means the split above it was wrong, and the honest response
 * is to throw before the ledger lies.
 */
export function recordRepayment(input: RepaymentInput): { remainingBase: bigint; repaid: boolean } {
  if (input.amountBase <= BigInt(0)) throw new Error("a repayment must be a positive amount");
  return db.transaction((t) => {
    const adv = t.select().from(advances).where(eq(advances.id, input.advanceId)).get();
    if (!adv) throw new Error(`no such advance: ${input.advanceId}`);
    if (adv.status !== "active") throw new Error(`advance ${input.advanceId} is ${adv.status}, not active`);
    const remaining = BigInt(adv.outstandingBase) - input.amountBase;
    if (remaining < BigInt(0)) {
      throw new Error(
        `repayment ${input.amountBase} exceeds outstanding ${adv.outstandingBase} on ${input.advanceId}`,
      );
    }
    t.insert(advanceRepayments)
      .values({
        id: `rep-${crypto.randomUUID().slice(0, 12)}`,
        advanceId: input.advanceId,
        submissionId: input.submissionId,
        amountBase: Number(input.amountBase),
        claimCommitment: input.claimCommitment ?? null,
        claimSecret: input.claimSecret ?? null,
        escrowTx: input.escrowTx,
        createdAt: now(),
      })
      .run();
    const repaid = remaining === BigInt(0);
    t.update(advances)
      .set({
        outstandingBase: Number(remaining),
        ...(repaid ? { status: "repaid" as const, repaidAt: now() } : {}),
      })
      .where(eq(advances.id, input.advanceId))
      .run();
    return { remainingBase: remaining, repaid };
  });
}

/**
 * A verified payout whose share could not be collected (the borrower withdrew the approval, or the money
 * had already left the wallet). Recorded with no transaction and a reason, so it is considered exactly once
 * and the balance it would have paid down is untouched: "at most N% of each payout", never a catch-up.
 */
export function recordMissedRepayment(input: { advanceId: string; submissionId: string; note: string }): void {
  db.insert(advanceRepayments)
    .values({
      id: `rep-${crypto.randomUUID().slice(0, 12)}`,
      advanceId: input.advanceId,
      submissionId: input.submissionId,
      amountBase: 0,
      claimCommitment: null,
      claimSecret: null,
      escrowTx: null,
      note: input.note.slice(0, 200),
      createdAt: now(),
    })
    .run();
}

/** Whether the pot has already covered this wallet's approval fee (once per wallet). */
export function getFeeTopup(wallet: string): { txHash: string; amountWei: string } | null {
  const row = db.select().from(advanceFeeTopups).where(eq(advanceFeeTopups.wallet, founderStorageKey(wallet))).get();
  return row ? { txHash: row.txHash, amountWei: row.amountWei } : null;
}

/**
 * Reserve a wallet's one fee cover BEFORE sending it: the primary key refuses a second reservation, so two
 * requests racing the same wallet cannot both send. False when it was already reserved or covered.
 */
export function reserveFeeTopup(input: { wallet: string; chainId: number; amountWei: bigint }): boolean {
  try {
    db.insert(advanceFeeTopups)
      .values({ wallet: founderStorageKey(input.wallet), chainId: input.chainId, amountWei: input.amountWei.toString(), txHash: "pending", createdAt: now() })
      .run();
    return true;
  } catch {
    return false;
  }
}

export function completeFeeTopup(wallet: string, txHash: string): void {
  db.update(advanceFeeTopups).set({ txHash }).where(eq(advanceFeeTopups.wallet, founderStorageKey(wallet))).run();
}

/** The send failed before reaching the chain: free the reservation so the wallet can be covered later. */
export function releaseFeeTopup(wallet: string): void {
  db.delete(advanceFeeTopups).where(eq(advanceFeeTopups.wallet, founderStorageKey(wallet))).run();
}

/** The credit file's view: the advance history for a wallet, newest first, with repayments. */
export function advanceHistory(wallet: string): Array<AdvanceRow & { repayments: typeof advanceRepayments.$inferSelect[] }> {
  const key = founderStorageKey(wallet);
  const rows = db.select().from(advances).where(eq(advances.borrowerWallet, key)).all();
  return rows
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((a) => ({
      ...a,
      repayments: db.select().from(advanceRepayments).where(eq(advanceRepayments.advanceId, a.id)).all(),
    }));
}
