import "server-only";

import { recoverTypedDataAddress, isAddress, getAddress, type Hex } from "viem";

/**
 * THE OKX x402 RAIL — a different rail from GOAT Flow, on a different chain, in a different token.
 *
 * Sage already had one paid rail: GOAT Flow, chain 2345, USDC, used for its own evidence-verification
 * fees (`facilitator.ts`). That is not the rail an OKX.AI buyer uses. OKX's marketplace settles on
 * X Layer (chain 196) in USD₮0, and its client pays with an EIP-3009 signed authorization rather than
 * by sending a transaction. Confirmed by reading a working listing's live 402 and by OKX's own
 * validator, which reports `scheme: exact, network: eip155:196, x402Version: 2`.
 *
 * The two rails do not share code beyond this comment, and deliberately so: they price different
 * things, in different tokens, for different callers.
 *
 * WHAT A PAYMENT IS HERE. The buyer signs a `TransferWithAuthorization` for an exact amount to our
 * address. The signature IS the payment instrument: anyone holding it can redeem it on-chain, which
 * is how the buyer pays no gas and we need none either. So the verification below is the whole
 * guarantee, and it checks the things that make an authorization ours and redeemable — the
 * recipient, the amount, the window, and that the signature genuinely covers those exact fields.
 * Getting `to` or `value` wrong would mean serving paid work for an authorization payable to someone
 * else, or for less than we asked.
 *
 * OFF UNLESS `OKX_X402_PAY_TO` IS SET. With no address to be paid at, there is nothing to verify
 * against, so the services run free and say so rather than pretending to charge.
 */

export const OKX_CHAIN_ID = 196;
export const OKX_NETWORK = "eip155:196" as const;
/** USD₮0 on X Layer — the token OKX's marketplace prices in. 6 decimals. */
export const OKX_ASSET = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
export const OKX_ASSET_SYMBOL = "USD₮0";
export const OKX_ASSET_DECIMALS = 6;
/** The EIP-712 domain fields for the asset, as the buyer's signer uses them. */
export const OKX_ASSET_EXTRA = { name: "USD₮0", version: "1" } as const;
/** How long a challenge stays payable. Matches what OKX's client expects to see. */
export const OKX_MAX_TIMEOUT_SECONDS = 300;

/** The header carrying the challenge. OKX reads this name; `x-` prefixed is not found. */
export const PAYMENT_REQUIRED_HEADER = "payment-required";
/**
 * The header carrying the buyer's signed authorization. Every name a real client uses is read,
 * because guessing wrong here is indistinguishable from the buyer not having paid: they send a
 * valid signature, we look under a different name, find nothing, and bill them again.
 *
 * `payment-sig` is the one OKX's own seller SDK sends and it was missing from this list.
 */
export const PAYMENT_HEADERS = [
  "payment-sig",
  "payment",
  "payment-signature",
  "x-payment",
] as const;

/**
 * OKX'S OFFICIAL REVIEW TEST ADDRESS, published in the listing-rejection notice with the explicit
 * instruction not to add validation logic that blocks it. It sends payment-exempt and micro-payment
 * requests to confirm a service is actually reachable.
 *
 * A micro-payment is under the listed price, so the ordinary amount check would refuse it and the
 * review would fail for a service that works perfectly. This exempts that ONE named address from
 * the amount floor only. Everything else still applies to it — the signature must verify, the
 * recipient must be us, the window must be open, and the nonce is still spent exactly once — so
 * this cannot become a way to buy real work for nothing.
 */
export const OKX_REVIEW_ADDRESS = "0xbc59eb75C55e3bF1E63aaeE653C2b8E02BFd2033";

/**
 * The exempt address, overridable by `OKX_X402_REVIEW_ADDRESS`. Two reasons it is not a bare
 * constant: OKX can rotate this address and a listing must not sit rejected waiting on a deploy to
 * follow, and the waiver is otherwise untestable — only OKX can sign as OKX, so a test cannot
 * produce the positive case without being able to point the exemption at a key it holds.
 */
export function okxReviewAddress(): string {
  const raw = process.env.OKX_X402_REVIEW_ADDRESS?.trim();
  return raw && isAddress(raw) ? getAddress(raw) : getAddress(OKX_REVIEW_ADDRESS);
}
/** The header carrying our acknowledgement back.  */
export const PAYMENT_RESPONSE_HEADER = "payment-response";

/** The address paid for OKX services. Unset → the rail is off. */
export function okxPayTo(): string | null {
  const raw = process.env.OKX_X402_PAY_TO?.trim();
  if (!raw || !isAddress(raw)) return null;
  return getAddress(raw);
}

export function okxX402Live(): boolean {
  return okxPayTo() !== null;
}

/** USDT-denominated price → minimal units (6dp), as an integer string. No float drift. */
export function priceToMinimal(usd: number): string {
  return String(Math.round(usd * 10 ** OKX_ASSET_DECIMALS));
}

export interface X402Challenge {
  x402Version: 2;
  error: string;
  resource: { url: string; description: string; mimeType: string };
  accepts: Array<{
    scheme: "exact";
    network: typeof OKX_NETWORK;
    amount: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: { name: string; version: string };
  }>;
}

/**
 * The challenge for one paid resource. `amount` must equal the fee registered for the service on the
 * marketplace — OKX validates price-match separately and a mismatch reads as a broken listing.
 */
export function buildOkxChallenge(input: {
  resourceUrl: string;
  description: string;
  priceUsd: number;
  payTo: string;
}): X402Challenge {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: input.resourceUrl,
      description: input.description,
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: OKX_NETWORK,
        amount: priceToMinimal(input.priceUsd),
        asset: OKX_ASSET,
        payTo: input.payTo,
        maxTimeoutSeconds: OKX_MAX_TIMEOUT_SECONDS,
        extra: { ...OKX_ASSET_EXTRA },
      },
    ],
  };
}

/** The challenge, base64 for the `payment-required` header. */
export function encodeChallenge(c: X402Challenge): string {
  return Buffer.from(JSON.stringify(c)).toString("base64");
}

/* ────────────────────────────── verifying what the buyer sent ───────────────────────────────── */

export interface PaymentAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/**
 * What a refused payment actually contained — the fields that say WHY, and nothing that is money.
 *
 * The listing sat rejected while the four services answered every probe correctly, so the rejection
 * was never about reachability. Reconstructed from nginx response sizes, OKX's reviewer sends a real
 * signed authorization to all four and each one is refused with "payable to a different address",
 * which is a rail difference rather than a fault: their buyer signs to a settlement address, not to
 * the seller. That was an inference from byte counts, and an inference is not an address. This
 * records the real one the next time a probe arrives.
 *
 * NEVER the signature. On this rail the signature IS the money — anyone holding it can redeem it —
 * so it stays out of logs even when the payment was refused, and especially then.
 */
export interface ObservedPayment {
  from: string | null;
  to: string | null;
  value: string | null;
  validBefore: string | null;
  scheme: string | null;
  network: string | null;
  /** the payload's own key names, which is how a shape mismatch shows itself. */
  shape: string[];
}

export type PaymentVerdict =
  | { ok: true; auth: PaymentAuthorization; payer: string; nonce: string; signature: string }
  | { ok: false; reason: string; observed?: ObservedPayment };

/** Read the first payment header a client actually sent, whichever name it chose. */
export function readPaymentHeader(headers: Headers): string | null {
  for (const name of PAYMENT_HEADERS) {
    const v = headers.get(name)?.trim();
    if (v) return v;
  }
  return null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** Base64 (or base64url, or bare JSON) → the payload object. Never throws. */
function decodePayment(header: string): Record<string, unknown> | null {
  const attempts = [
    () => JSON.parse(header) as unknown,
    () => JSON.parse(Buffer.from(header, "base64").toString("utf8")) as unknown,
    () => JSON.parse(Buffer.from(header.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as unknown,
  ];
  for (const attempt of attempts) {
    try {
      const v = attempt();
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* try the next encoding */
    }
  }
  return null;
}

/**
 * Verify a buyer's signed authorization against what this resource actually demanded.
 *
 * Every check here is one an attacker would otherwise get for free. An authorization payable to
 * someone else is not payment to us. An authorization for less than the price is not payment for
 * this. An expired one cannot be redeemed. And a signature that does not recover to the stated payer
 * means the fields were edited after signing — the amount is the obvious one to raise, or the
 * recipient to swap, so the recovery is checked over the exact typed data, not over a summary of it.
 *
 * `nowSeconds` is injected so the time window is testable without waiting for real time to pass.
 */
export async function verifyOkxPayment(
  header: string,
  expected: { payTo: string; minAmount: string },
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<PaymentVerdict> {
  const payload = decodePayment(header);
  if (!payload) return { ok: false, reason: "The payment header is not readable JSON or base64 JSON." };

  const scheme = str(payload.scheme);
  const network = str(payload.network);

  const inner = (payload.payload ?? payload) as Record<string, unknown>;
  const rawAuth = (inner.authorization ?? inner) as Record<string, unknown>;

  // Built before any check runs, so a refusal can always say what it was looking at. Signature
  // deliberately absent — see ObservedPayment.
  const observed: ObservedPayment = {
    from: str(rawAuth.from) || null,
    to: str(rawAuth.to) || null,
    value: str(rawAuth.value) || null,
    validBefore: str(rawAuth.validBefore) || null,
    scheme: scheme || null,
    network: network || null,
    shape: Object.keys(payload).concat(rawAuth === payload ? [] : Object.keys(rawAuth)).slice(0, 24),
  };
  const fail = (reason: string): PaymentVerdict => ({ ok: false, reason, observed });

  if (scheme && scheme !== "exact") {
    return fail(`Unsupported payment scheme "${scheme}". This resource accepts "exact".`);
  }
  if (network && network !== OKX_NETWORK) {
    return fail(`Payment is on ${network}; this resource is priced on ${OKX_NETWORK}.`);
  }

  const signature = str(inner.signature ?? payload.signature);
  if (!signature.startsWith("0x")) return fail("The payment carries no signature.");

  const auth: PaymentAuthorization = {
    from: str(rawAuth.from),
    to: str(rawAuth.to),
    value: str(rawAuth.value),
    validAfter: str(rawAuth.validAfter) || "0",
    validBefore: str(rawAuth.validBefore),
    nonce: str(rawAuth.nonce),
  };
  if (!isAddress(auth.from) || !isAddress(auth.to)) {
    return fail("The payment authorization is missing a valid payer or recipient.");
  }
  if (!/^\d+$/.test(auth.value) || !/^\d+$/.test(auth.validBefore) || !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) {
    return fail("The payment authorization is malformed.");
  }

  // Paid to us, in full. Either failing means this is not payment for this resource.
  if (getAddress(auth.to) !== getAddress(expected.payTo)) {
    return fail("The payment authorization is payable to a different address.");
  }
  // The amount floor, waived ONLY for OKX's named review address (see OKX_REVIEW_ADDRESS): its
  // micro-payment probes are deliberately under price, and refusing them fails the availability
  // check for a service that works. Every other check below still runs against it unchanged.
  const isReviewProbe = getAddress(auth.from) === okxReviewAddress();
  if (!isReviewProbe && BigInt(auth.value) < BigInt(expected.minAmount)) {
    return fail("The payment authorization is for less than this service's price.");
  }

  // Still redeemable. An expired authorization is a signature over money that can no longer move.
  if (Number(auth.validBefore) <= nowSeconds) {
    return fail("The payment authorization has expired.");
  }
  if (Number(auth.validAfter) > nowSeconds) {
    return fail("The payment authorization is not valid yet.");
  }

  // Signed by the payer, over exactly these fields.
  let recovered: string;
  try {
    recovered = await recoverTypedDataAddress({
      domain: {
        name: OKX_ASSET_EXTRA.name,
        version: OKX_ASSET_EXTRA.version,
        chainId: OKX_CHAIN_ID,
        verifyingContract: getAddress(OKX_ASSET),
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: getAddress(auth.from),
        to: getAddress(auth.to),
        value: BigInt(auth.value),
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce as Hex,
      },
      signature: signature as Hex,
    });
  } catch {
    return fail("The payment signature could not be verified.");
  }
  if (getAddress(recovered) !== getAddress(auth.from)) {
    return fail("The payment signature does not match the stated payer.");
  }

  return { ok: true, auth, payer: getAddress(auth.from), nonce: auth.nonce.toLowerCase(), signature };
}
