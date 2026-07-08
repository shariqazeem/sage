import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { GOAT_CHAIN_ID, GOAT_USDC, isX402Live } from "./facilitator";
import { agentAddress, usdToWeiString } from "./goat-pay";
import { goatClient } from "./goat-client";
import { paywallDecision, settleStatus } from "./payer-core";

type Handler = (req: NextRequest) => Promise<Response> | Response;

/**
 * Wrap a route handler with the GOAT x402 paywall.
 * - Not live → BYPASS: run the handler, tag `x-x402: bypass`. Never a fake charge.
 * - Live, no `X-Payment-Order` header → create an order and return HTTP 402 with
 *   the payment requirement (the payer transfers, then retries with the header).
 * - Live, header present + facilitator says PAYMENT_CONFIRMED → serve, tag paid.
 * - Live, header present but unconfirmed → 402 pending (the payer waits).
 */
export function withX402Paywall(
  handler: Handler,
  opts: { amountUsd: number; symbol?: string },
): Handler {
  return async (req: NextRequest) => {
    const live = isX402Live();

    if (!live) {
      const res = await handler(req);
      res.headers.set("x-x402", "bypass");
      return res;
    }

    const client = goatClient();
    if (!client) {
      // isX402Live() true but client missing is a contradiction — fail closed.
      return NextResponse.json({ x402: true, error: "x402 misconfigured" }, { status: 500 });
    }

    const orderId = req.headers.get("x-payment-order");
    let confirmed = false;
    if (orderId) {
      try {
        const status = await client.getOrderStatus(orderId);
        confirmed = settleStatus(status.status) === "paid";
      } catch {
        confirmed = false;
      }
    }

    const verdict = paywallDecision({ live, orderId, confirmed });

    if (verdict === "serve") {
      const res = await handler(req);
      res.headers.set("x-x402", "paid");
      if (orderId) res.headers.set("x-payment-order", orderId);
      return res;
    }

    if (verdict === "pending") {
      return NextResponse.json(
        { x402: true, orderId, pending: true },
        { status: 402 },
      );
    }

    // require-payment → create an order and return the requirement.
    try {
      const order = await client.createOrder({
        dappOrderId: `verify-${nanoid(10)}`,
        chainId: GOAT_CHAIN_ID,
        tokenSymbol: opts.symbol ?? "USDC",
        tokenContract: GOAT_USDC,
        fromAddress: agentAddress(),
        amountWei: usdToWeiString(opts.amountUsd),
      });
      const paymentMethod =
        order.x402?.extensions?.goatx402?.paymentMethod ?? "transfer";
      const body = {
        x402: true as const,
        orderId: order.orderId,
        payTo: order.payToAddress,
        amountWei: order.amountWei,
        tokenContract: order.tokenContract,
        chainId: GOAT_CHAIN_ID,
        flow: order.flow,
        paymentMethod,
      };
      return NextResponse.json(body, {
        status: 402,
        headers: {
          "x-payment-required": Buffer.from(
            JSON.stringify(order.x402 ?? body),
          ).toString("base64"),
        },
      });
    } catch {
      return NextResponse.json(
        { x402: true, error: "could not create payment order" },
        { status: 502 },
      );
    }
  };
}
