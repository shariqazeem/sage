import "server-only";

import type { GoatX402Client } from "goatx402-sdk-server";
import { GOAT_CHAIN_ID, GOAT_USDC, isX402Live } from "./facilitator";
import { agentAddress, transferUsdc, usdToWeiString } from "./goat-pay";
import { goatClient } from "./goat-client";
import {
  runOperatorFee,
  runPayAndCall,
  settleStatus,
  type MerchantClient,
  type PayResult,
} from "./payer-core";

/** Real on-chain transfer, adapted to the core's injected TransferFn shape. */
const transfer = async (payTo: string, amountWei: string) => {
  const { txHash } = await transferUsdc(payTo, amountWei);
  return { txHash };
};

/**
 * Adapt the raw GoatX402Client to the core's MerchantClient — overriding
 * confirmation with an INVOICED-aware poll.
 *
 * The SDK's built-in `waitForConfirmation` only treats `PAYMENT_CONFIRMED` (and
 * the failure states) as terminal, so it hangs until timeout against a DIRECT
 * merchant, which settles to `INVOICED`. We poll `getOrderStatus` ourselves and
 * stop the instant `settleStatus()` is terminal (paid OR failed). The caller
 * re-checks `settleStatus` and rejects anything that isn't `paid`.
 */
function asMerchantClient(client: GoatX402Client): MerchantClient {
  return {
    createOrder: (params) => client.createOrder(params),
    waitForConfirmation: async (orderId, opts) => {
      const timeout = opts?.timeout ?? 120_000;
      const interval = opts?.interval ?? 4_000;
      const deadline = Date.now() + timeout;
      for (;;) {
        const s = await client.getOrderStatus(orderId);
        if (settleStatus(s.status) !== "pending") {
          return { status: s.status, txHash: s.txHash };
        }
        if (Date.now() >= deadline) {
          throw new Error(
            `x402: confirmation timeout for order ${orderId} (last status ${s.status})`,
          );
        }
        await new Promise((r) => setTimeout(r, interval));
      }
    },
  };
}

/**
 * RAIL 1 — the Deputy pays for a gated resource (the real x402 flow), or a single
 * bypass call when the rail isn't live. `paymentTx` is a real GOAT tx or null.
 */
export function payAndCall<T>(opts: {
  url: string;
  body: unknown;
  amountUsd: number;
}): Promise<PayResult<T>> {
  const client = goatClient();
  return runPayAndCall<T>({
    url: opts.url,
    body: opts.body,
    live: isX402Live(),
    fetchImpl: fetch,
    transfer,
    client: client ? asMerchantClient(client) : null,
  });
}

/**
 * RAIL 2 — a direct operator-fee payment. Live only (callers guard it and only
 * reach here when live). Returns the real GOAT payment tx.
 */
export async function payOperatorFee(opts: {
  dappOrderId: string;
  amountUsd: number;
}): Promise<{ paymentTx: string; orderId: string }> {
  const client = goatClient();
  if (!client) throw new Error("x402 not live — no operator fee charged.");
  return runOperatorFee({
    dappOrderId: opts.dappOrderId,
    fromAddress: agentAddress(),
    tokenContract: GOAT_USDC,
    chainId: GOAT_CHAIN_ID,
    amountWei: usdToWeiString(opts.amountUsd),
    transfer,
    client: asMerchantClient(client),
  });
}
