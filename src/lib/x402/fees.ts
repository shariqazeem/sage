import "server-only";

import { short } from "@/lib/format";
import {
  listPendingFees,
  markFeeSettled,
  recordEvent,
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
export async function payPendingFees(): Promise<{ settled: number; pending: number }> {
  if (!isX402Live()) return { settled: 0, pending: 0 };
  const pending = listPendingFees();
  let settled = 0;
  let stillPending = 0;
  for (const fee of pending) {
    const outcome = await guardedFee(() =>
      payOperatorFee({ dappOrderId: `fee-${fee.id}`, amountUsd: OPERATOR_FEE_USD }),
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
      stillPending += 1; // stays pending; no journal spam on repeated retries.
    }
  }
  return { settled, pending: stillPending };
}
