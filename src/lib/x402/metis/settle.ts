import "server-only";

import { keccak256, type Hex } from "viem";
import type { X402MetisSettlementRow } from "@/lib/db/schema";
import type { MetisChain } from "./chain";
import type { MetisFacilitatorConfig } from "./config";
import { METIS_EXPLORER, REASON, SETTLE_DEADLINE_MARGIN_SECONDS } from "./constants";
import { parseFacilitatorRequest } from "./parse";
import {
  buildLegacySettleTx,
  decidePending,
  encodeSettleCall,
  paymentKey,
  settleFailure,
  settleGasLimit,
  settleSuccess,
  transferMatches,
  type PendingDecision,
  type TransferExpectation,
} from "./settle-core";
import { STALE_CLAIM_SECONDS, type ClaimStore } from "./store";
import type { ParsedPayment, SettleResponse } from "./types";
import { policyOf, verifyOnChain } from "./verify";
import { checkTerms, checkWindow, isNonceUsed, nonceWordPos } from "./verify-core";

/**
 * POST /settle (x402-specification-v2.md §7.2): the one place this facilitator moves money, by
 * sending x402ExactPermit2Proxy.settle() from its own key as a LEGACY transaction.
 *
 * NEVER TWICE. Replay is refused by two independent things, and the first is authoritative:
 *   1. the chain: Permit2 spends each payer nonce once (re-read here, and simulated, before sending);
 *   2. the claim ledger (store.ts), keyed by that same nonce: a payment is claimed by compare-and-set
 *      before anything is signed, and its transaction hash is recorded BEFORE it is sent. Two
 *      concurrent settles of one payment produce one broadcast, and a payment gets exactly one
 *      success response, ever: the request that moves its row to `settled`.
 *
 * NEVER LOST. When the receipt does not come in time the answer is `settlement_pending` with the
 * hash, as the spec allows, and a retry of the same payment reconciles against the recorded hash
 * (decidePending) instead of sending again.
 */

/** One settle at a time picks a nonce, signs, records and sends; the receipt wait runs outside. */
export interface SendLane {
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  /** The node's pending count, or one past the last nonce this process sent, whichever is higher. */
  nextNonce(pendingCount: number): number;
  /** Called only after a send succeeded, so a failed send leaves no gap in the sequence. */
  used(nonce: number): void;
}

export function createSendLane(): SendLane {
  let tail: Promise<unknown> = Promise.resolve();
  let last = -1;
  return {
    exclusive<T>(fn: () => Promise<T>): Promise<T> {
      const run = tail.then(fn, fn);
      tail = run.catch(() => undefined);
      return run;
    },
    nextNonce: (pendingCount) => Math.max(pendingCount, last + 1),
    used(nonce) {
      if (nonce > last) last = nonce;
    },
  };
}

export interface SettleDeps {
  config: Pick<MetisFacilitatorConfig, "account" | "proxy" | "assets" | "payToAllowlist">;
  chain: MetisChain;
  claims: ClaimStore;
  nowSeconds: () => number;
  lane: SendLane;
  /** Spends one of the day's broadcasts; false when the cap is reached. */
  takeBroadcastSlot: () => boolean;
  receiptTimeoutMs: number;
}

/** Bumped over eth_gasPrice, as Sage's other Metis writes do (deputy/signer.ts, native-send.ts). */
const GAS_PRICE_BUMP_PERCENT = BigInt(120);

const sameTerms = (row: X402MetisSettlementRow, p: ParsedPayment): boolean =>
  row.asset === p.token.toLowerCase() && row.amount === p.amount.toString() && row.payTo === p.witnessTo.toLowerCase();

function expectedTransfer(p: ParsedPayment): TransferExpectation {
  return { asset: p.token, from: p.payer, to: p.witnessTo, amount: p.amount };
}

/** Turn a decision about a broadcast payment into its one ledger move and its response. */
function conclude(p: ParsedPayment, key: string, hash: Hex, decision: PendingDecision, deps: SettleDeps): SettleResponse {
  const now = deps.nowSeconds();
  const who = { payer: p.payer };
  switch (decision.kind) {
    case "settled":
      // Only the request that moves the row to `settled` may answer success. Any other request that
      // reaches this point for the same payment answers as a replay, so one payment buys one resource.
      return deps.claims.move(key, "pending", "settled", null, now)
        ? settleSuccess(p, hash)
        : settleFailure(REASON.permit2InvalidNonce, `this payment was already settled (${METIS_EXPLORER}/tx/${hash})`, who);
    case "mismatch":
      deps.claims.move(key, "pending", "mismatch", REASON.transferEventMismatch, now);
      return settleFailure(
        REASON.transferEventMismatch,
        "the transaction succeeded but its Transfer log is not this payment",
        { ...who, transaction: hash },
      );
    case "reverted":
      deps.claims.move(key, "pending", "failed", REASON.transactionFailed, now);
      return settleFailure(REASON.transactionFailed, "the settle transaction reverted; nothing moved", {
        ...who,
        transaction: hash,
      });
    case "dropped":
      deps.claims.move(key, "pending", "failed", "dropped", now);
      return settleFailure(
        REASON.transactionFailed,
        "the earlier settle transaction was never mined and nothing moved; settle again to retry",
        who,
      );
    case "expired":
      deps.claims.move(key, "pending", "failed", REASON.permit2DeadlineExpired, now);
      return settleFailure(REASON.permit2DeadlineExpired, "the permit expired before it was settled; nothing moved", who);
    case "consumed":
      deps.claims.move(key, "pending", "failed", REASON.permit2InvalidNonce, now);
      return settleFailure(
        REASON.permit2InvalidNonce,
        "this payment's nonce was spent by another transaction than this facilitator's",
        who,
      );
    case "pending":
      return settleFailure(
        REASON.settlementPending,
        "the settle transaction was sent and has not been confirmed yet; settle the same payment again to reconcile",
        { ...who, transaction: hash },
      );
  }
}

/** A payment whose transaction was recorded earlier: learn what became of it, never send again. */
async function reconcile(p: ParsedPayment, key: string, row: X402MetisSettlementRow, deps: SettleDeps): Promise<SettleResponse> {
  const hash = row.txHash as Hex | null;
  if (!hash || row.txNonce === null) {
    return settleFailure(REASON.invalidTransactionState, "this payment's settlement record is incomplete", { payer: p.payer });
  }
  const [receipt, bitmap, confirmed] = await Promise.all([
    deps.chain.waitForReceipt(hash, Math.min(deps.receiptTimeoutMs, 10_000)),
    deps.chain.nonceBitmap(p.payer, nonceWordPos(p.nonce)),
    deps.chain.transactionCount(deps.config.account.address, "latest"),
  ]);
  const now = deps.nowSeconds();
  const decision = decidePending(
    {
      receipt,
      permit2NonceUsed: isNonceUsed(bitmap, p.nonce),
      facilitatorConfirmedNonce: confirmed,
      txNonce: row.txNonce,
      broadcastAgeSeconds: now - row.updatedAt,
      nowSeconds: now,
      deadline: BigInt(row.deadline),
    },
    expectedTransfer(p),
  );
  return conclude(p, key, hash, decision, deps);
}

export async function settlePayment(body: unknown, deps: SettleDeps): Promise<SettleResponse> {
  const parsed = parseFacilitatorRequest(body);
  if (!parsed.ok) return settleFailure(parsed.reason, parsed.message, { payer: parsed.payer, network: parsed.network });
  const p = parsed.payment;
  const who = { payer: p.payer };

  const terms = await checkTerms(p, policyOf(deps.config));
  if (!terms.ok) return settleFailure(terms.reason, terms.message, who);

  const key = paymentKey(p.payer, p.nonce);
  const row = deps.claims.get(key);
  if (row) {
    if (!sameTerms(row, p)) {
      return settleFailure(REASON.permit2InvalidNonce, "this Permit2 nonce was already used for a different payment", who);
    }
    if (row.status === "settled" || row.status === "mismatch") {
      // spec scheme_exact.md "Replay": a consumed primitive MUST produce a settlement failure, never a success.
      const where = row.txHash ? ` (${METIS_EXPLORER}/tx/${row.txHash})` : "";
      return settleFailure(REASON.permit2InvalidNonce, `this payment was already settled${where}`, who);
    }
    if (row.status === "pending") return reconcile(p, key, row, deps);
    if (row.status === "settling" && deps.nowSeconds() - row.updatedAt < STALE_CLAIM_SECONDS) {
      return settleFailure(REASON.invalidTransactionState, "this payment is already being settled", who);
    }
  }

  const window = checkWindow(p, deps.nowSeconds(), SETTLE_DEADLINE_MARGIN_SECONDS);
  if (!window.ok) return settleFailure(window.reason, window.message, who);

  const onChain = await verifyOnChain(p, deps);
  if (!onChain.ok) return settleFailure(onChain.reason, onChain.message, who);

  const data = encodeSettleCall(p);
  const from = deps.config.account.address;
  const [estimate, basePrice, gasBalance] = await Promise.all([
    deps.chain.estimateGas(from, deps.config.proxy, data),
    deps.chain.gasPrice(),
    deps.chain.nativeBalance(from),
  ]);
  const gas = settleGasLimit(estimate);
  if (gas === null) {
    return settleFailure(REASON.unexpectedSettleError, `the settle call estimates ${estimate} gas, above this facilitator's cap`, who);
  }
  const gasPrice = (basePrice * GAS_PRICE_BUMP_PERCENT) / BigInt(100);
  if (gasBalance < gas * gasPrice) {
    return settleFailure(REASON.unexpectedSettleError, "the facilitator does not hold enough METIS for gas right now", who);
  }
  if (!deps.takeBroadcastSlot()) {
    return settleFailure(REASON.unexpectedSettleError, "this facilitator's daily settlement cap is reached", who);
  }
  if (!deps.claims.claim(p, deps.nowSeconds())) {
    return settleFailure(REASON.invalidTransactionState, "this payment is already being settled", who);
  }

  // Pick the nonce, sign, RECORD THE HASH, then send: in that order, so that whatever happens after
  // this point there is a record of the one transaction that might move this payment.
  const sent = await deps.lane.exclusive(async () => {
    let recorded = false;
    try {
      const nonce = deps.lane.nextNonce(await deps.chain.transactionCount(from, "pending"));
      const serialized = await deps.config.account.signTransaction(
        buildLegacySettleTx({ proxy: deps.config.proxy, data, gas, gasPrice, nonce }),
      );
      const hash = keccak256(serialized);
      recorded = deps.claims.recordBroadcast(key, hash, nonce, deps.nowSeconds());
      if (!recorded) return { kind: "lost" as const };
      try {
        await deps.chain.sendRawTransaction(serialized);
        deps.lane.used(nonce);
        return { kind: "sent" as const, hash };
      } catch {
        // The node may or may not have taken it. The hash is on record, so the outcome is resolved
        // by reconciliation rather than by guessing now.
        return { kind: "unsure" as const, hash };
      }
    } catch (e) {
      if (!recorded) deps.claims.move(key, "settling", "failed", "not sent", deps.nowSeconds());
      throw e;
    }
  });

  if (sent.kind === "lost") {
    return settleFailure(REASON.invalidTransactionState, "this payment is already being settled", who);
  }
  if (sent.kind === "unsure") return conclude(p, key, sent.hash, { kind: "pending" }, deps);

  const receipt = await deps.chain.waitForReceipt(sent.hash, deps.receiptTimeoutMs);
  const decision: PendingDecision =
    receipt.status === "success"
      ? transferMatches(receipt.logs, expectedTransfer(p))
        ? { kind: "settled" }
        : { kind: "mismatch" }
      : receipt.status === "reverted"
        ? { kind: "reverted" }
        : { kind: "pending" };
  return conclude(p, key, sent.hash, decision, deps);
}
