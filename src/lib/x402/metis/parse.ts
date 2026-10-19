import { getAddress, isAddress, type Address, type Hex } from "viem";
import { METIS_NETWORK, REASON } from "./constants";
import type { ParsedPayment, Requirements } from "./types";

/**
 * STRICT PARSING of a /verify or /settle body (x402-specification-v2.md §7.1, §7.2) into the shape
 * the verification core works on. Pure.
 *
 * Every number that can move money is a decimal string of atomic units, as the spec and the
 * reference client write them; a JSON number, a hex string, a sign or a fraction is refused rather
 * than coerced, and nothing above 2^256-1 is accepted (it could not be a uint256 on chain).
 * Addresses may arrive in any case and are checksummed here, so every later comparison is between
 * normalized values.
 */

const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
const DECIMAL = /^[0-9]{1,78}$/;
const HEX_BYTES = /^0x(?:[0-9a-fA-F]{2})*$/;

export type ParseResult =
  | { ok: true; payment: ParsedPayment }
  | { ok: false; reason: string; message: string; payer?: Address; network: string };

class Refusal extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function record(v: unknown, field: string, reason: string = REASON.invalidPayload): Record<string, unknown> {
  if (!isRecord(v)) throw new Refusal(reason, `${field} must be an object`);
  return v;
}

function uint(v: unknown, field: string, reason: string = REASON.invalidPayload): bigint {
  if (typeof v !== "string" || !DECIMAL.test(v)) {
    throw new Refusal(reason, `${field} must be a decimal string of atomic units`);
  }
  const n = BigInt(v);
  if (n > MAX_UINT256) throw new Refusal(reason, `${field} does not fit in a uint256`);
  return n;
}

function address(v: unknown, field: string, reason: string = REASON.invalidPayload): Address {
  if (typeof v !== "string" || !isAddress(v, { strict: false })) {
    throw new Refusal(reason, `${field} must be an EVM address`);
  }
  return getAddress(v);
}

function requirements(v: unknown, field: string): Requirements {
  const reason = REASON.invalidPaymentRequirements;
  const r = record(v, field, reason);
  if (typeof r.scheme !== "string") throw new Refusal(reason, `${field}.scheme must be a string`);
  if (typeof r.network !== "string") throw new Refusal(reason, `${field}.network must be a string`);
  const maxTimeoutSeconds = r.maxTimeoutSeconds;
  if (typeof maxTimeoutSeconds !== "number" || !Number.isInteger(maxTimeoutSeconds) || maxTimeoutSeconds <= 0) {
    throw new Refusal(reason, `${field}.maxTimeoutSeconds must be a positive integer`);
  }
  let assetTransferMethod: string | null = null;
  if (r.extra !== undefined) {
    const extra = record(r.extra, `${field}.extra`, reason);
    if (extra.assetTransferMethod !== undefined) {
      if (typeof extra.assetTransferMethod !== "string") {
        throw new Refusal(reason, `${field}.extra.assetTransferMethod must be a string`);
      }
      assetTransferMethod = extra.assetTransferMethod;
    }
  }
  return {
    scheme: r.scheme,
    network: r.network,
    amount: uint(r.amount, `${field}.amount`, reason),
    asset: address(r.asset, `${field}.asset`, reason),
    payTo: address(r.payTo, `${field}.payTo`, reason),
    maxTimeoutSeconds,
    assetTransferMethod,
  };
}

/** The payer named in a body, if one parses, so even a refusal can say whose payment it was. */
function payerOf(body: unknown): Address | undefined {
  if (!isRecord(body) || !isRecord(body.paymentPayload)) return undefined;
  const inner = body.paymentPayload.payload;
  if (!isRecord(inner) || !isRecord(inner.permit2Authorization)) return undefined;
  const from = inner.permit2Authorization.from;
  return typeof from === "string" && isAddress(from, { strict: false }) ? getAddress(from) : undefined;
}

function networkOf(body: unknown): string {
  if (isRecord(body) && isRecord(body.paymentRequirements) && typeof body.paymentRequirements.network === "string") {
    return body.paymentRequirements.network;
  }
  return METIS_NETWORK;
}

export function parseFacilitatorRequest(body: unknown): ParseResult {
  try {
    const b = record(body, "body");
    if (b.x402Version !== 2) throw new Refusal(REASON.invalidX402Version, "x402Version must be 2");
    const pp = record(b.paymentPayload, "paymentPayload");
    if (pp.x402Version !== 2) throw new Refusal(REASON.invalidX402Version, "paymentPayload.x402Version must be 2");
    const req = requirements(b.paymentRequirements, "paymentRequirements");
    const accepted = requirements(pp.accepted, "paymentPayload.accepted");

    const inner = record(pp.payload, "paymentPayload.payload");
    if (inner.permit2Authorization === undefined) {
      if (inner.authorization !== undefined) {
        throw new Refusal(
          REASON.eip3009NotSupported,
          "m.USDC and m.USDT on Metis have no transferWithAuthorization (EIP-3009); pay with the permit2 method",
        );
      }
      throw new Refusal(REASON.invalidPayload, "paymentPayload.payload.permit2Authorization is missing");
    }
    const auth = record(inner.permit2Authorization, "permit2Authorization");
    const permitted = record(auth.permitted, "permit2Authorization.permitted");
    const witness = record(auth.witness, "permit2Authorization.witness");
    const signature = inner.signature;
    if (typeof signature !== "string" || !HEX_BYTES.test(signature)) {
      throw new Refusal(REASON.invalidPayload, "paymentPayload.payload.signature must be 0x-prefixed hex bytes");
    }

    const payment: ParsedPayment = {
      requirements: req,
      accepted,
      payer: address(auth.from, "permit2Authorization.from"),
      token: address(permitted.token, "permit2Authorization.permitted.token"),
      amount: uint(permitted.amount, "permit2Authorization.permitted.amount"),
      spender: address(auth.spender, "permit2Authorization.spender"),
      nonce: uint(auth.nonce, "permit2Authorization.nonce"),
      deadline: uint(auth.deadline, "permit2Authorization.deadline"),
      witnessTo: address(witness.to, "permit2Authorization.witness.to"),
      validAfter: uint(witness.validAfter, "permit2Authorization.witness.validAfter"),
      signature: signature as Hex,
    };
    return { ok: true, payment };
  } catch (e) {
    if (e instanceof Refusal) {
      return { ok: false, reason: e.reason, message: e.message, payer: payerOf(body), network: networkOf(body) };
    }
    throw e;
  }
}
