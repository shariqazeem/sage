import {
  decodeEventLog,
  encodeFunctionData,
  isAddressEqual,
  type Address,
  type Hex,
  type TransactionSerializableLegacy,
} from "viem";
import { ERC20_ABI, EXACT_PROXY_ABI, METIS_CHAIN_ID, METIS_NETWORK, SETTLE_GAS_CAP } from "./constants";
import type { ParsedPayment, SettleResponse } from "./types";

/**
 * THE SETTLEMENT CORE, pure: what settle.ts sends, how it reads the outcome, and what it concludes
 * about a payment whose transaction it cannot see yet.
 */

/**
 * The idempotency key of a payment: Permit2's own replay primitive, the payer's unordered nonce.
 *
 * Not the signature. An ECDSA signature can be re-encoded (s and n - s both verify), and a payer can
 * sign the same permit twice; either way it is the same nonce and so the same payment. Keyed by the
 * signature, a re-encoded copy would look new and win a second broadcast, which Permit2 would revert
 * on the facilitator's gas. Keyed by nonce, it lands on the row of the first.
 */
export function paymentKey(payer: Address, nonce: bigint): string {
  return `${METIS_NETWORK}:${payer.toLowerCase()}:${nonce.toString()}`;
}

/** calldata for x402ExactPermit2Proxy.settle(permit, owner, witness, signature). */
export function encodeSettleCall(p: ParsedPayment): Hex {
  return encodeFunctionData({
    abi: EXACT_PROXY_ABI,
    functionName: "settle",
    args: [
      { permitted: { token: p.token, amount: p.amount }, nonce: p.nonce, deadline: p.deadline },
      p.payer,
      { to: p.witnessTo, validAfter: p.validAfter },
      p.signature,
    ],
  });
}

/**
 * The gas limit for a settle: the estimate plus a quarter and a little, refused (null) above the
 * cap. An estimate that high means the call does something a Permit2 transfer does not.
 */
export function settleGasLimit(estimate: bigint): bigint | null {
  const limit = estimate + estimate / BigInt(4) + BigInt(10_000);
  return limit > BigInt(SETTLE_GAS_CAP) ? null : limit;
}

/**
 * The settle transaction, LEGACY (type 0) with an EIP-155 chain id. Andromeda has no EIP-1559: its
 * blocks carry no baseFeePerGas and its EVM has no BASEFEE opcode (both measured 19 Oct 2026).
 */
export function buildLegacySettleTx(input: {
  proxy: Address;
  data: Hex;
  gas: bigint;
  gasPrice: bigint;
  nonce: number;
}): TransactionSerializableLegacy {
  return {
    type: "legacy",
    chainId: METIS_CHAIN_ID,
    to: input.proxy,
    data: input.data,
    gas: input.gas,
    gasPrice: input.gasPrice,
    nonce: input.nonce,
    value: BigInt(0),
  };
}

export interface LogLike {
  address: string;
  topics: readonly Hex[];
  data: Hex;
}

export interface TransferExpectation {
  asset: Address;
  from: Address;
  to: Address;
  amount: bigint;
}

/**
 * scheme_exact.md "Transfer correctness": a settlement MUST produce exactly one identifiable transfer
 * of `amount` of `asset` to `payTo`. Read from the receipt's Transfer logs, not from the status: the
 * status says the transaction ran, the log says where the money went.
 */
function decodeTransfer(log: LogLike): { from: Address; to: Address; value: bigint } | null {
  const [signature, ...args] = log.topics;
  if (signature === undefined) return null;
  try {
    const decoded = decodeEventLog({ abi: ERC20_ABI, eventName: "Transfer", topics: [signature, ...args], data: log.data });
    return { from: decoded.args.from, to: decoded.args.to, value: decoded.args.value };
  } catch {
    return null;
  }
}

export function transferMatches(logs: readonly LogLike[], e: TransferExpectation): boolean {
  let matching = 0;
  let fromPayer = 0;
  for (const log of logs) {
    if (log.address.toLowerCase() !== e.asset.toLowerCase()) continue;
    const t = decodeTransfer(log);
    if (!t || !isAddressEqual(t.from, e.from)) continue;
    fromPayer += 1;
    if (isAddressEqual(t.to, e.to) && t.value === e.amount) matching += 1;
  }
  return matching === 1 && fromPayer === 1;
}

export type ReceiptFact =
  | { status: "success"; logs: readonly LogLike[] }
  | { status: "reverted" }
  | { status: "unknown" };

/** What settle.ts reads before deciding about a payment it broadcast but never saw land. */
export interface PendingFacts {
  receipt: ReceiptFact;
  /** Permit2.nonceBitmap says the payment's nonce is spent. */
  permit2NonceUsed: boolean;
  /** The facilitator's confirmed transaction count (eth_getTransactionCount at "latest"). */
  facilitatorConfirmedNonce: number;
  /** The nonce the recorded transaction was signed with. */
  txNonce: number;
  /** Seconds since the transaction was recorded as broadcast. */
  broadcastAgeSeconds: number;
  nowSeconds: number;
  /** The permit's deadline. */
  deadline: bigint;
}

export type PendingDecision =
  | { kind: "settled" }
  | { kind: "mismatch" }
  | { kind: "reverted" }
  | { kind: "dropped" }
  | { kind: "expired" }
  | { kind: "consumed" }
  | { kind: "pending" };

/** Seconds to let RPC nodes agree before concluding from an absence. */
export const DROP_AFTER_SECONDS = 60;
/** Seconds past the permit's deadline before it is certain nothing can still move the funds. */
export const DEADLINE_GRACE_SECONDS = 60;
/** Seconds before a spent nonce with no receipt of ours is read as someone else's settlement. */
export const CONSUMED_AFTER_SECONDS = 600;

/**
 * NEVER TWO SUCCESSES, NEVER A LOST PAYMENT. A payment whose transaction was recorded but whose
 * outcome is unknown is resolved here, and the rule is to conclude only from a positive fact:
 *
 *   - a receipt decides it (success is checked against the Transfer log);
 *   - "dropped": the facilitator's own nonce has been used by another confirmed transaction and the
 *     permit's nonce is still unspent, so the recorded transaction can never be mined and no money
 *     moved. Safe to try again;
 *   - "expired": past the deadline (plus grace) with the nonce unspent. Permit2 refuses an expired
 *     permit, so nothing can move these funds any more;
 *   - "consumed": the nonce is spent, the facilitator's transaction is not the one that spent it, and
 *     long enough has passed for that to be certain. Someone else settled the signed payment; the
 *     spec says a consumed primitive is a failure, never a success;
 *   - anything else is still "pending", and the caller is told so (`settlement_pending`) rather than
 *     guessed at.
 */
export function decidePending(f: PendingFacts, expected: TransferExpectation): PendingDecision {
  if (f.receipt.status === "success") {
    return transferMatches(f.receipt.logs, expected) ? { kind: "settled" } : { kind: "mismatch" };
  }
  if (f.receipt.status === "reverted") return { kind: "reverted" };
  const ourNonceSpent = f.facilitatorConfirmedNonce > f.txNonce;
  if (!f.permit2NonceUsed) {
    if (ourNonceSpent && f.broadcastAgeSeconds >= DROP_AFTER_SECONDS) return { kind: "dropped" };
    if (BigInt(f.nowSeconds) > f.deadline + BigInt(DEADLINE_GRACE_SECONDS)) return { kind: "expired" };
    return { kind: "pending" };
  }
  if (ourNonceSpent && f.broadcastAgeSeconds >= CONSUMED_AFTER_SECONDS) return { kind: "consumed" };
  return { kind: "pending" };
}

export function settleSuccess(p: ParsedPayment, transaction: Hex): SettleResponse {
  return { success: true, transaction, network: METIS_NETWORK, payer: p.payer, amount: p.amount.toString() };
}

export function settleFailure(
  reason: string,
  message: string,
  opts: { payer?: string; network?: string; transaction?: string } = {},
): SettleResponse {
  return {
    success: false,
    errorReason: reason,
    errorMessage: message,
    transaction: opts.transaction ?? "",
    network: opts.network ?? METIS_NETWORK,
    ...(opts.payer ? { payer: opts.payer } : {}),
  };
}
