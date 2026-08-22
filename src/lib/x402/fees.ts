import "server-only";

import { short } from "@/lib/format";
import {
  listPendingFees,
  markFeeSettled,
  nextFeeAttempt,
  recordFeePaid,
  stuckFees,
  recordEvent,
  recordFeeFailure,
  recordPendingFee,
} from "@/lib/db/campaigns";
import { isX402Live, OPERATOR_FEE_USD } from "./facilitator";
import { usdToWei } from "./goat-pay";
import { payOperatorFee } from "./payer";
import { guardedFee } from "./payer-core";

const FEE_BASE = Number(usdToWei(OPERATOR_FEE_USD)); // 0.1 USDC → 100000

/**
 * RAIL 2 — the post-settle hook. Records the operator fee owed for a settled
 * payout (idempotent, journaled once as `fee_pending`). It does NOT move money
 * here and NEVER throws, so a payout is never blocked or failed by the fee. The
 * real USDC movement happens in `payPendingFees` (the sweep).
 */
export function chargeOperatorFee(
  settleTx: string,
  meta: { campaignId?: string | null; submissionId?: string | null },
): void {
  try {
    const inserted = recordPendingFee({
      settleTx,
      campaignId: meta.campaignId,
      submissionId: meta.submissionId,
      amountBase: FEE_BASE,
    });
    if (inserted && meta.campaignId) {
      recordEvent({
        campaignId: meta.campaignId,
        submissionId: meta.submissionId ?? null,
        kind: "fee_pending",
        detail: `operator fee 0.1 USDC — ${isX402Live() ? "queued" : "x402 rail not configured"}`,
      });
    }
  } catch (err) {
    // A failed fee record must never affect the payout it followed.
    console.error("[x402] recordPendingFee failed (payout unaffected):", err);
  }
}

/**
 * Pay every pending operator fee over the real x402 rail — the sweep's fee step.
 * Live only. Each fee is guarded so one failure never stops the rest, and a
 * failed fee stays pending for the next sweep. A settlement journals `fee_settled`
 * with the real GOAT tx; nothing here ever records a fee that didn't move.
 */
/**
 * STOP RETRYING A FEE THAT CANNOT SUCCEED YET.
 *
 * Measured on production: ten $0.10 fees from the 16 Aug campaign each reached ~1,900 attempts,
 * every one failing `ERC20: transfer amount exceeds balance` because the operator wallet cannot
 * cover them. Because the loop was unbounded that cost 2,880 x402 quote requests a day and 19,000
 * doomed transfer simulations, for a week, to re-learn one fact.
 *
 * The order-id fix and the `stuck` counter made this VISIBLE; neither made it STOP. Past the cap a
 * fee is skipped before it costs a single network call. Nothing is written off — the row keeps its
 * status, amount and reason, and {@link resumeDeferredFees} puts it back in the queue once the
 * wallet can actually pay it.
 */
export const MAX_FEE_ATTEMPTS = 25;

export async function payPendingFees(): Promise<{
  settled: number;
  pending: number;
  /** pending fees that have failed repeatedly, with the current reason — see below. */
  stuck?: number;
  stuckReason?: string | null;
  /** fees past {@link MAX_FEE_ATTEMPTS}, skipped without touching the network. */
  deferred?: number;
}> {
  if (!isX402Live()) return { settled: 0, pending: 0 };
  const pending = listPendingFees();
  let settled = 0;
  let stillPending = 0;
  let deferred = 0;
  for (const fee of pending) {
    // Past the cap: skip BEFORE the quote and the transfer, so a wallet that cannot pay costs
    // nothing per tick instead of two network calls per fee, forever.
    if (fee.attempts >= MAX_FEE_ATTEMPTS && !fee.paymentTx) {
      deferred += 1;
      continue;
    }
    // ALREADY PAID, JUST NOT CONFIRMED. A row keeps its payment_tx the instant the transfer receipt
    // lands, so if we are here with one set, the USDC is already at the merchant and re-sending
    // would be a genuine double-spend. Settle it on the receipt and move on.
    if (fee.paymentTx) {
      markFeeSettled(fee.id, fee.paymentTx, fee.orderId ?? "");
      settled += 1;
      continue;
    }
    // A FRESH dappOrderId PER ATTEMPT. It used to be `fee-<id>`, fixed for the life of the fee, so
    // once the first order expired unpaid every later retry died on the facilitator's "order already
    // exists" before reaching the transfer — nine fees stranded from 6 July to 9 August, roughly
    // 8,000 silent retries, and 67 unpayable invoices on the merchant dashboard. Our own fee.id
    // remains the idempotency key, so this cannot charge the same fee twice.
    const attempt = nextFeeAttempt(fee.id);
    const outcome = await guardedFee(() =>
      payOperatorFee({
        dappOrderId: `fee-${fee.id}-${attempt}`,
        amountUsd: OPERATOR_FEE_USD,
        // Persist the tx BEFORE confirmation polling can fail. This is the whole guard: money that
        // has moved must be recorded even if everything after it throws.
        onTransferred: (paymentTx, orderId) => recordFeePaid(fee.id, paymentTx, orderId),
      }),
    );
    if (outcome.status === "settled") {
      markFeeSettled(fee.id, outcome.paymentTx, outcome.orderId);
      if (fee.campaignId) {
        recordEvent({
          campaignId: fee.campaignId,
          submissionId: fee.submissionId,
          kind: "fee_settled",
          detail: `operator fee 0.1 USDC · ${short(outcome.paymentTx)}`,
          txHash: outcome.paymentTx,
          amount: fee.amountBase,
        });
      }
      settled += 1;
    } else {
      // Stays pending, and the REASON is now written to the row. Still no journal event per retry
      // (that would bury the campaign timeline every five minutes), but discarding the error string
      // entirely — which guardedFee had already captured — is what let this rail fail in complete
      // silence for a month. A failure nobody can read is indistinguishable from work not done.
      recordFeeFailure(fee.id, outcome.error);
      stillPending += 1;
    }
  }
  // What is STUCK, not merely pending. The watcher logged `"fees":{"settled":0,"pending":9}` every
  // five minutes for a month and it read as ordinary backlog, because a count alone cannot
  // distinguish "waiting its turn" from "has failed 8,000 times for the same reason". The reason
  // itself now rides along, so the next rail failure is legible from one line of the sweep log.
  const stuck = stuckFees(3);
  return {
    settled,
    pending: stillPending,
    ...(stuck.length > 0
      ? { stuck: stuck.length, stuckReason: stuck[0].lastError?.slice(0, 120) ?? null }
      : {}),
    ...(deferred > 0 ? { deferred } : {}),
  };
}
