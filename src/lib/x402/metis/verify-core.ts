import {
  decodeErrorResult,
  isAddressEqual,
  recoverTypedDataAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import type { X402MetisSettlementStatus } from "@/lib/db/schema";
import {
  ERC20_ABI,
  EXACT_PROXY_ABI,
  METIS_NETWORK,
  PERMIT2_ABI,
  PERMIT2_DOMAIN,
  PERMIT2_WITNESS_TYPES,
  REASON,
  VERIFY_DEADLINE_MARGIN_SECONDS,
} from "./constants";
import type { Check, ParsedPayment } from "./types";

/**
 * THE VERIFICATION CORE, pure: every rule a Permit2 payment must pass, with the chain reads handed in
 * as data. verify.ts does the I/O and composes these, in this order.
 *
 * ORDER. scheme_exact_evm.md §2 Phase 3 lists the checks as signature, allowance, balance, amount,
 * validity window, token and network, then simulation. The reference facilitator (exact/facilitator/
 * permit2.ts) runs the static checks first and the signature last of them, then the chain reads. This
 * follows the reference, except that the validity window comes after the signature (see checkWindow).
 * Whether a payment is valid does not depend on the order, only which reason is named first, and
 * checking what costs nothing before what costs an RPC call means a malformed or foreign payment
 * never reaches the node. Allowance is still read before balance, as the spec orders.
 *
 * Where this is stricter than the reference, each place says why. In short: it refuses anything the
 * chain would refuse, so the facilitator never pays gas to learn what it could have read.
 */

const ok: Check = { ok: true };
const fail = (reason: string, message: string): Check => ({ ok: false, reason, message });

export interface StaticPolicy {
  /** The proxy the payer must have named as spender: the configured one, checked on chain. */
  proxy: Address;
  /** The assets this facilitator settles. */
  assets: readonly Address[];
  /** When set, the only payees this facilitator settles for. */
  payToAllowlist: readonly Address[] | null;
}

/** Recover the Permit2 signer, or null. Mirrors Permit2's SignatureVerification for an EOA. */
export async function recoverPermit2Signer(p: ParsedPayment): Promise<Address | null> {
  // 65 bytes, as the reference verifier requires (shared/verifySignature.ts verifyECDSA). Permit2 would
  // also take a 64-byte EIP-2098 signature; refusing it is the stricter reading and costs no payer
  // anything, since every wallet signs 65 bytes.
  if (p.signature.length !== 132) return null;
  // Permit2 hands `v` to ecrecover verbatim, and ecrecover answers address(0) for anything but 27 or
  // 28, so Permit2 reverts InvalidSignature. viem would happily recover v = 0 or 1; without this
  // check the facilitator would accept a signature the chain refuses.
  const v = parseInt(p.signature.slice(130, 132), 16);
  if (v !== 27 && v !== 28) return null;
  try {
    return await recoverTypedDataAddress({
      domain: PERMIT2_DOMAIN,
      types: PERMIT2_WITNESS_TYPES,
      primaryType: "PermitWitnessTransferFrom",
      message: {
        permitted: { token: p.token, amount: p.amount },
        spender: p.spender,
        nonce: p.nonce,
        deadline: p.deadline,
        witness: { to: p.witnessTo, validAfter: p.validAfter },
      },
      signature: p.signature,
    });
  } catch {
    return null;
  }
}

/**
 * Every check that needs no chain read: the terms (checkTerms, which ends with the signature) and
 * then the validity window (checkWindow). `deadlineMargin` is the seconds the deadline must still be
 * ahead of `now`: the reference's 6 for /verify, more for /settle (constants.ts says why).
 */
export async function checkPayment(
  p: ParsedPayment,
  policy: StaticPolicy,
  nowSeconds: number,
  deadlineMargin: number = VERIFY_DEADLINE_MARGIN_SECONDS,
): Promise<Check> {
  const terms = await checkTerms(p, policy);
  return terms.ok ? checkWindow(p, nowSeconds, deadlineMargin) : terms;
}

/**
 * The validity window, kept apart from the terms because time moves and terms do not: a /settle
 * retried after the deadline must still be able to learn what became of a payment it already
 * broadcast, so that path checks the terms and skips this.
 */
export function checkWindow(p: ParsedPayment, nowSeconds: number, deadlineMargin: number): Check {
  const now = BigInt(nowSeconds);
  if (p.deadline < now + BigInt(deadlineMargin)) {
    return fail(REASON.permit2DeadlineExpired, "the permit's deadline has passed or is too close to settle");
  }
  if (p.validAfter > now) {
    return fail(REASON.permit2NotYetValid, "witness.validAfter is in the future");
  }
  return ok;
}

/** The time-independent checks, the signature last. */
export async function checkTerms(p: ParsedPayment, policy: StaticPolicy): Promise<Check> {
  const req = p.requirements;
  const acc = p.accepted;

  if (req.scheme !== "exact" || acc.scheme !== "exact") {
    return fail(REASON.unsupportedScheme, "this facilitator settles the exact scheme only");
  }
  if (req.network !== METIS_NETWORK) {
    return fail(REASON.invalidNetwork, `this facilitator settles ${METIS_NETWORK} (Metis Andromeda) only`);
  }
  if (acc.network !== req.network) {
    return fail(REASON.networkMismatch, "the payment was made for a different network than the requirements");
  }

  // scheme_exact_evm.md §2: for the permit2 method `extra.assetTransferMethod` is REQUIRED and MUST
  // be "permit2" (the reference does not check it; the spec says required, so this does). Without it a
  // client defaults to eip3009, which m.USDC cannot do.
  if (req.assetTransferMethod !== "permit2") {
    return fail(
      REASON.invalidPaymentRequirements,
      'paymentRequirements.extra.assetTransferMethod must be "permit2": m.USDC on Metis has no EIP-3009',
    );
  }
  if (acc.assetTransferMethod !== null && acc.assetTransferMethod !== "permit2") {
    return fail(REASON.invalidPaymentRequirements, "the payment was accepted under a different transfer method");
  }

  // The client's `accepted` is a copy of one entry of the server's `accepts`. Agreeing with the
  // requirements the server sent is the least it can do; the reference compares only scheme and
  // network, and comparing the money fields too costs nothing.
  if (
    !isAddressEqual(acc.asset, req.asset) ||
    !isAddressEqual(acc.payTo, req.payTo) ||
    acc.amount !== req.amount
  ) {
    return fail(REASON.invalidPaymentRequirements, "the payment accepted different terms than the requirements");
  }

  if (!policy.assets.some((a) => isAddressEqual(a, req.asset))) {
    return fail(REASON.invalidPaymentRequirements, "this facilitator does not settle that asset on Metis");
  }
  if (isAddressEqual(req.payTo, zeroAddress)) {
    return fail(REASON.invalidPaymentRequirements, "payTo is the zero address");
  }
  if (policy.payToAllowlist && !policy.payToAllowlist.some((a) => isAddressEqual(a, req.payTo))) {
    return fail(REASON.invalidPaymentRequirements, "this facilitator does not settle for that payTo");
  }
  if (req.amount === BigInt(0)) {
    return fail(REASON.invalidPaymentRequirements, "the required amount is zero");
  }

  if (!isAddressEqual(p.spender, policy.proxy)) {
    return fail(
      REASON.permit2InvalidSpender,
      `the permit names spender ${p.spender}; on Metis it must be the proxy ${policy.proxy}`,
    );
  }
  if (!isAddressEqual(p.witnessTo, req.payTo)) {
    return fail(REASON.permit2RecipientMismatch, "witness.to is not the payTo of the requirements");
  }

  // EXACT, as the reference requires (permit2.ts: `permitted.amount !== requirements.amount`). The
  // spec's prose says the amount must "cover" the payment, but the scheme is `exact`, the proxy moves
  // the full permitted amount, and §9 defines the mismatch code as "does not exactly match". Short is
  // refused because the payee would be underpaid; over is refused because the payer would be charged
  // more than the price.
  if (p.amount !== req.amount) {
    return fail(
      REASON.permit2AmountMismatch,
      p.amount < req.amount
        ? "the permit authorizes less than the required amount"
        : "the permit authorizes more than the required amount",
    );
  }
  if (!isAddressEqual(p.token, req.asset)) {
    return fail(REASON.permit2TokenMismatch, "the permit is for a different token than the requirements");
  }

  const signer = await recoverPermit2Signer(p);
  if (!signer || !isAddressEqual(signer, p.payer)) {
    return fail(REASON.permit2InvalidSignature, "the signature does not recover to permit2Authorization.from");
  }
  return ok;
}

/** Permit2's unordered nonces: word = nonce >> 8, bit = nonce & 0xff (SignatureTransfer.bitmapPositions). */
export function nonceWordPos(nonce: bigint): bigint {
  return nonce >> BigInt(8);
}

export function isNonceUsed(bitmap: bigint, nonce: bigint): boolean {
  const bit = nonce & BigInt(255);
  return ((bitmap >> bit) & BigInt(1)) === BigInt(1);
}

/** What the chain says about the payer, read by verify.ts. */
export interface ChainFacts {
  /** Whether the payer address holds contract code. */
  payerHasCode: boolean;
  /** asset.allowance(payer, Permit2). */
  allowance: bigint;
  /** asset.balanceOf(payer). */
  balance: bigint;
  /** Permit2.nonceBitmap(payer, nonceWordPos(nonce)). */
  nonceBitmap: bigint;
}

export function judgeChainFacts(p: ParsedPayment, facts: ChainFacts): Check {
  // For an address with code Permit2 verifies through EIP-1271, not ecrecover, so the ECDSA check above
  // proves nothing about what the chain will accept. The reference calls isValidSignature; this
  // refuses instead, because a contract can answer a simulation one way and the real call another,
  // and the facilitator would pay for the difference.
  if (facts.payerHasCode) {
    return fail(
      REASON.permit2InvalidSignature,
      "the payer is a contract; this facilitator settles payments signed by an EOA only",
    );
  }
  if (facts.allowance < p.amount) {
    return fail(
      REASON.permit2AllowanceRequired,
      "the payer has not approved Permit2 for this token: one approve(Permit2) transaction is needed first",
    );
  }
  if (facts.balance < p.amount) {
    return fail(REASON.permit2InsufficientBalance, "the payer's balance does not cover the payment");
  }
  if (isNonceUsed(facts.nonceBitmap, p.nonce)) {
    return fail(REASON.permit2InvalidNonce, "this payment's Permit2 nonce has already been used on chain");
  }
  return ok;
}

/** A settlement row in flight or done means the payment is spoken for, whatever the chain says yet. */
export function judgeClaim(status: X402MetisSettlementStatus | null): Check {
  if (status === null || status === "failed") return ok;
  return fail(
    REASON.permit2InvalidNonce,
    status === "settled" || status === "mismatch"
      ? "this payment was already settled by this facilitator"
      : "this payment is already being settled by this facilitator",
  );
}

/** Name a revert from the proxy, Permit2 or the token, for a person reading the reason. */
export function describeRevert(data: Hex | undefined): string {
  if (!data || data === "0x") return "reverted without data";
  try {
    const decoded = decodeErrorResult({ abi: [...EXACT_PROXY_ABI, ...PERMIT2_ABI, ...ERC20_ABI], data });
    const args = decoded.args && decoded.args.length > 0 ? `(${decoded.args.map(String).join(", ")})` : "";
    return `${decoded.errorName}${args}`;
  } catch {
    return `reverted with ${data.slice(0, 10)}`;
  }
}

export function judgeSimulation(sim: { ok: true } | { ok: false; revertData?: Hex }): Check {
  if (sim.ok) return ok;
  return fail(REASON.permit2SimulationFailed, `simulating the settlement failed: ${describeRevert(sim.revertData)}`);
}
