/**
 * The x402 payer's PURE orchestration — the real handshake, with every I/O
 * (HTTP, on-chain transfer, facilitator client) injected so it unit-tests
 * without `server-only`. `payer.ts` composes these with the real GOAT deps.
 *
 * The GOAT flow (confirmed from goatx402-sdk-server source + api.x402.goat.network
 * docs): create/receive an order → the payer transfers USDC to the order's payTo
 * on GOAT (ERC20_DIRECT) → the facilitator confirms the on-chain transfer →
 * proof. NOTHING is simulated: paymentTx is a real tx or it's null (bypassed).
 */

export interface PaymentOrder {
  orderId: string;
  payTo: string;
  /** atomic units (USDC 6dp) as a string. */
  amountWei: string;
  tokenContract: string;
  chainId: number;
  paymentMethod: "transfer" | "eip3009-signature";
  flow?: string;
}

/** Pull the order fields out of our middleware's 402 body. */
export function extractOrder(body: unknown): PaymentOrder | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const orderId = typeof o.orderId === "string" ? o.orderId : "";
  const payTo = typeof o.payTo === "string" ? o.payTo : "";
  const amountWei = typeof o.amountWei === "string" ? o.amountWei : "";
  if (!orderId || !payTo || !amountWei) return null;
  return {
    orderId,
    payTo,
    amountWei,
    tokenContract: typeof o.tokenContract === "string" ? o.tokenContract : "",
    chainId: typeof o.chainId === "number" ? o.chainId : 0,
    paymentMethod:
      o.paymentMethod === "eip3009-signature" ? "eip3009-signature" : "transfer",
    flow: typeof o.flow === "string" ? o.flow : undefined,
  };
}

export type TransferFn = (
  payTo: string,
  amountWei: string,
) => Promise<{ txHash: string }>;

/** The subset of GoatX402Client the payer needs. */
export interface MerchantClient {
  createOrder(params: {
    dappOrderId: string;
    chainId: number;
    tokenSymbol: string;
    tokenContract: string;
    fromAddress: string;
    amountWei: string;
  }): Promise<{
    orderId: string;
    payToAddress: string;
    amountWei: string;
    tokenContract: string;
    flow: string;
  }>;
  waitForConfirmation(
    orderId: string,
    opts?: { timeout?: number; interval?: number },
  ): Promise<{ status: string; txHash?: string }>;
}

export interface PayResult<T> {
  result: T;
  /** the real GOAT payment tx, or null when the paywall was bypassed. */
  paymentTx: string | null;
  bypassed: boolean;
}

/**
 * RAIL 1 — the Deputy pays for a gated resource. Call → 402 → transfer USDC →
 * facilitator confirm → retry with proof. When not live, a single bypass call
 * (no payment), clearly flagged. Injected deps make the whole flow testable.
 */
export async function runPayAndCall<T>(opts: {
  url: string;
  body: unknown;
  live: boolean;
  fetchImpl: typeof fetch;
  transfer: TransferFn;
  client: MerchantClient | null;
  /** default true — poll the facilitator for PAYMENT_CONFIRMED before retrying. */
  confirm?: boolean;
}): Promise<PayResult<T>> {
  const { url, body, live, fetchImpl, transfer, client } = opts;
  const post = (headers: Record<string, string>) =>
    fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  if (!live) {
    const res = await post({ "x-x402-bypass": "1" });
    const result = (await res.json()) as T;
    if (!res.ok) throw new Error(`x402 bypass call failed (${res.status})`);
    return { result, paymentTx: null, bypassed: true };
  }

  const first = await post({});
  if (first.status !== 402) {
    const result = (await first.json()) as T;
    if (!first.ok) throw new Error(`x402 resource failed (${first.status})`);
    return { result, paymentTx: null, bypassed: false };
  }

  const order = extractOrder(await first.json());
  if (!order) throw new Error("x402: malformed payment-required response");
  if (order.paymentMethod !== "transfer") {
    throw new Error(`x402: unsupported payment method '${order.paymentMethod}'`);
  }

  // P17/P19 probe — the gated resource sets its own price, so there's no "ours" to compare; still log the
  // quoted magnitude so an 18-dp mis-quote is visible (6-dp 0.1 = 100000; 18-dp 0.1 = 1e17).
  console.warn(`[x402-probe] gated-resource order=${order.orderId} · quotedWei=${order.amountWei}`);
  const pay = await transfer(order.payTo, order.amountWei);

  if (client && opts.confirm !== false) {
    const conf = await client.waitForConfirmation(order.orderId, {
      timeout: 120_000,
      interval: 4_000,
    });
    if (settleStatus(conf.status) !== "paid") {
      throw new Error(`x402: order not confirmed (${conf.status})`);
    }
  }

  const retry = await post({
    "x-payment-order": order.orderId,
    "x-payment-tx": pay.txHash,
  });
  const result = (await retry.json()) as T;
  if (!retry.ok) {
    throw new Error(`x402: paywalled call failed after payment (${retry.status})`);
  }
  return { result, paymentTx: pay.txHash, bypassed: false };
}

/**
 * P17/P19 x402 FEE-QUOTE PROBE — the money we compute is 6-dp USDC (usdToWei(0.1) = 100000). The
 * facilitator ECHOES an amount back on the order, and we transfer `order.amountWei || ours`. If the
 * facilitator quotes 0.1 in 18 decimals (1e17) against 6-dp USDC, the transfer asks for ~10^12x the
 * intended amount and REVERTS — the reverting-fee mystery. This logs the exact numbers so the hypothesis
 * is CONFIRMED or KILLED by a real value (grep `[x402-probe]` in the pm2 logs), and returns the amount to
 * actually send: unchanged by default, or CLAMPED to our 6-dp value when X402_CLAMP_FEE_DECIMALS=1 AND
 * the quote looks ~10^12x too large (a facilitator-side mis-denomination we defend against client-side).
 */
function probeAndResolveFeeWei(ctx: string, ourWei: string, quotedWei: string | undefined | null): string {
  const ZERO = BigInt(0);
  let ours = ZERO;
  let quoted = ZERO;
  try {
    ours = BigInt(ourWei || "0");
    quoted = quotedWei ? BigInt(quotedWei) : ZERO;
  } catch {
    /* keep zeros */
  }
  // 6-dp: 0.1 USDC = 100000. 18-dp: 0.1 = 1e17. So an 18-vs-6 mis-denomination shows a ~10^12 ratio.
  const ratio = ours > ZERO && quoted > ZERO ? Number(quoted) / Number(ours) : 0;
  const looks18dp = ours > ZERO && quoted > ZERO && ratio >= 1e11;
  const verdict =
    quoted === ZERO
      ? "facilitator returned no amount → we send our 6-dp value"
      : quoted === ours
        ? "MATCH — quote == our 6-dp value (denomination OK)"
        : looks18dp
          ? `MISMATCH — quote ~${ratio.toExponential(1)}x ours → 18-dp-vs-6-dp CONFIRMED (facilitator-side)`
          : `MISMATCH — quote != ours (ratio ${ratio.toExponential(1)})`;
  const clamp = looks18dp && process.env.X402_CLAMP_FEE_DECIMALS === "1";
  console.warn(`[x402-probe] ${ctx} · ourWei=${ourWei} quotedWei=${quotedWei ?? "none"} · ${verdict}${clamp ? " · CLAMPED to ours" : ""}`);
  if (clamp) return ourWei;
  return quotedWei || ourWei;
}

/**
 * RAIL 2 — a direct fee payment (no resource): create an order, transfer USDC to
 * its payTo, confirm. Returns the real tx. Throws on any failure (the fee caller
 * guards it so a payout is never affected).
 */
export async function runOperatorFee(opts: {
  dappOrderId: string;
  fromAddress: string;
  tokenContract: string;
  chainId: number;
  amountWei: string;
  transfer: TransferFn;
  client: MerchantClient;
  confirm?: boolean;
}): Promise<{ paymentTx: string; orderId: string }> {
  const order = await opts.client.createOrder({
    dappOrderId: opts.dappOrderId,
    chainId: opts.chainId,
    tokenSymbol: "USDC",
    tokenContract: opts.tokenContract,
    fromAddress: opts.fromAddress,
    amountWei: opts.amountWei,
  });
  const sendWei = probeAndResolveFeeWei(
    `operator-fee ${opts.dappOrderId} order=${order.orderId}`,
    opts.amountWei,
    order.amountWei,
  );
  const pay = await opts.transfer(order.payToAddress, sendWei);
  if (opts.confirm !== false) {
    const conf = await opts.client.waitForConfirmation(order.orderId, {
      timeout: 120_000,
      interval: 4_000,
    });
    if (settleStatus(conf.status) !== "paid") {
      throw new Error(`x402: fee order not confirmed (${conf.status})`);
    }
  }
  return { paymentTx: pay.txHash, orderId: order.orderId };
}

export type FeeOutcome =
  | { status: "settled"; paymentTx: string; orderId: string }
  | { status: "pending"; error: string };

/**
 * Guard a fee payment so it can NEVER throw — a failed fee becomes a pending
 * outcome the sweep retries, and the payout it followed is untouched.
 */
export async function guardedFee(
  pay: () => Promise<{ paymentTx: string; orderId: string }>,
): Promise<FeeOutcome> {
  try {
    const { paymentTx, orderId } = await pay();
    return { status: "settled", paymentTx, orderId };
  } catch (err) {
    return { status: "pending", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Map a GOAT order status to a settlement outcome. This is the load-bearing
 * distinction the live rail taught us: a **DIRECT** merchant (funds land straight
 * in the merchant wallet) settles a confirmed on-chain transfer to `INVOICED` —
 * the facilitator records the tx, stamps `confirmed_at`, and issues a *signed
 * proof*. `INVOICED` is therefore terminal SUCCESS, not an intermediate step.
 * `PAYMENT_CONFIRMED` is the terminal for facilitator-custody (DELEGATE) flows.
 * Both count as paid. FAILED/EXPIRED/CANCELLED are terminal failures; everything
 * else (e.g. CHECKOUT_VERIFIED) is still in flight.
 *
 * Waiting only for `PAYMENT_CONFIRMED` — as the SDK's own `waitForConfirmation`
 * and our first cut did — hangs forever against a DIRECT merchant. The live
 * test surfaced exactly that.
 */
export function settleStatus(status: string): "paid" | "failed" | "pending" {
  if (status === "INVOICED" || status === "PAYMENT_CONFIRMED") return "paid";
  if (status === "FAILED" || status === "EXPIRED" || status === "CANCELLED") {
    return "failed";
  }
  return "pending";
}

export type PaywallVerdict = "bypass" | "require-payment" | "serve" | "pending";

/** The middleware's decision: bypass (not live), require payment, serve, or pending. */
export function paywallDecision(input: {
  live: boolean;
  orderId: string | null;
  confirmed: boolean;
}): PaywallVerdict {
  if (!input.live) return "bypass";
  if (!input.orderId) return "require-payment";
  return input.confirmed ? "serve" : "pending";
}
