import "server-only";

import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { Hex } from "viem";
import { db } from "@/lib/db";
import {
  x402MetisSettlements,
  type X402MetisSettlementRow,
  type X402MetisSettlementStatus,
} from "@/lib/db/schema";
import { METIS_NETWORK } from "./constants";
import { paymentKey } from "./settle-core";
import type { ParsedPayment } from "./types";

/**
 * THE CLAIM LEDGER: the database half of replay safety (the chain's Permit2 nonce bitmap is the other
 * half, read in verify.ts). Every write is a compare-and-set on the row's current status, so two
 * /settle calls racing on one payment cannot both reach a broadcast: exactly one claim wins, and
 * a transaction is only sent after its hash is recorded against the winning claim.
 */

/**
 * A claim still `settling` (no transaction signed) after this long belongs to a request that died
 * before signing. Since the hash is recorded BEFORE anything is sent, such a row has never been
 * broadcast, and a new request may take it over.
 */
export const STALE_CLAIM_SECONDS = 120;

export interface ClaimStore {
  get(key: string): X402MetisSettlementRow | null;
  /** Claim a payment for settlement: a new row, a `failed` one, or a stale `settling` one. */
  claim(p: ParsedPayment, nowSeconds: number): boolean;
  /** settling → pending, with the hash and nonce of the transaction about to be sent. */
  recordBroadcast(key: string, txHash: Hex, txNonce: number, nowSeconds: number): boolean;
  /** Compare-and-set from one status to another. */
  move(
    key: string,
    from: X402MetisSettlementStatus,
    to: X402MetisSettlementStatus,
    errorReason: string | null,
    nowSeconds: number,
  ): boolean;
}

export const dbClaimStore: ClaimStore = {
  get(key) {
    return db.select().from(x402MetisSettlements).where(eq(x402MetisSettlements.paymentKey, key)).get() ?? null;
  },

  claim(p, nowSeconds) {
    const key = paymentKey(p.payer, p.nonce);
    const inserted = db
      .insert(x402MetisSettlements)
      .values({
        paymentKey: key,
        network: METIS_NETWORK,
        payer: p.payer.toLowerCase(),
        nonce: p.nonce.toString(),
        asset: p.token.toLowerCase(),
        amount: p.amount.toString(),
        payTo: p.witnessTo.toLowerCase(),
        deadline: p.deadline.toString(),
        status: "settling",
        createdAt: nowSeconds,
        updatedAt: nowSeconds,
      })
      .onConflictDoNothing()
      .run();
    if (inserted.changes === 1) return true;
    const taken = db
      .update(x402MetisSettlements)
      .set({ status: "settling", txHash: null, txNonce: null, errorReason: null, updatedAt: nowSeconds })
      .where(
        and(
          eq(x402MetisSettlements.paymentKey, key),
          or(
            eq(x402MetisSettlements.status, "failed"),
            and(
              eq(x402MetisSettlements.status, "settling"),
              isNull(x402MetisSettlements.txHash),
              lt(x402MetisSettlements.updatedAt, nowSeconds - STALE_CLAIM_SECONDS),
            ),
          ),
        ),
      )
      .run();
    return taken.changes === 1;
  },

  recordBroadcast(key, txHash, txNonce, nowSeconds) {
    const res = db
      .update(x402MetisSettlements)
      .set({ status: "pending", txHash, txNonce, updatedAt: nowSeconds })
      .where(and(eq(x402MetisSettlements.paymentKey, key), eq(x402MetisSettlements.status, "settling")))
      .run();
    return res.changes === 1;
  },

  move(key, from, to, errorReason, nowSeconds) {
    const res = db
      .update(x402MetisSettlements)
      .set({ status: to, errorReason, updatedAt: nowSeconds })
      .where(and(eq(x402MetisSettlements.paymentKey, key), eq(x402MetisSettlements.status, from)))
      .run();
    return res.changes === 1;
  },
};
