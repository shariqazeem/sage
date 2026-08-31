import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { advances, advanceRepayments, type AdvanceRow } from "@/lib/db/schema";
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
  };
  db.insert(advances).values(row).run();
  return row;
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

export function recordDisbursement(
  advanceId: string,
  d: { tx: string; claimCommitment: string; claimSecret: string },
): void {
  db.update(advances)
    .set({ disburseTx: d.tx, disburseClaimCommitment: d.claimCommitment, disburseClaimSecret: d.claimSecret })
    .where(eq(advances.id, advanceId))
    .run();
}

export interface RepaymentInput {
  advanceId: string;
  submissionId: string;
  amountBase: bigint;
  claimCommitment: string;
  claimSecret: string;
  escrowTx: string;
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
        claimCommitment: input.claimCommitment,
        claimSecret: input.claimSecret,
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
