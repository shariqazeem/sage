import "server-only";

import { getAddress, isAddress, type Address } from "viem";
import { M_USDC, METIS_NETWORK } from "./constants";
import { facilitatorReady, settleDepsFor, verifyDepsFor } from "./http";
import { settlePayment } from "./settle";
import { verifyPayment } from "./verify";
import type { PaymentRequirementsWire, SettleResponse } from "./types";
import { serviceOf, type PricedService } from "@/lib/mcp/pricing";

/**
 * SAGE SELLS ITS OWN TOOLS OVER ITS OWN FACILITATOR ON METIS (25 Oct 2026).
 *
 * The facilitator (http.ts, verify.ts, settle.ts) lets anyone sell for m.USDC on Metis. This is the
 * first seller: Sage's four paid tools, at their own addresses (`/mcp/metis/<tool>`), so an AI agent can
 * pay another agent in USDC on Metis end to end, and the free `/mcp/public/<tool>` doors that a
 * marketplace lists as free stay exactly as they are.
 *
 * A call goes: no payment → 402 with the requirements (exact, permit2, m.USDC, the tool's price, paid
 * to Sage, the Metis proxy as spender) → the agent signs a Permit2 witness transfer and calls again with
 * it in the PAYMENT-SIGNATURE header → Sage verifies it and SETTLES it before the tool runs, so a call
 * is served only once its USDC has moved. Every check, the exactly-once guarantee and the gas are the
 * facilitator's own; nothing here re-implements them.
 *
 * Off until the facilitator is on and there is somewhere to be paid: `X402_METIS_PAY_TO`, else the
 * billing address (`SAGE_BILLING_ADDRESS`).
 */

/** The address Sage is paid at on Metis, or null. */
export function metisSellerPayTo(env: Readonly<Record<string, string | undefined>> = process.env): Address | null {
  for (const raw of [env.X402_METIS_PAY_TO, env.SAGE_BILLING_ADDRESS]) {
    const v = raw?.trim();
    if (v && isAddress(v)) return getAddress(v);
  }
  return null;
}

/** USD → m.USDC base units (6 dp), as the integer string the requirements carry. */
export const usdToBase = (usd: number): string => String(Math.round(usd * 1_000_000));

/** The one accepts entry a Metis payment must answer (x402 v2 §5.1.2, scheme_exact_evm §2). */
export function metisRequirements(input: { priceUsd: number; payTo: Address; proxy: Address }): PaymentRequirementsWire {
  return {
    scheme: "exact",
    network: METIS_NETWORK,
    amount: usdToBase(input.priceUsd),
    asset: M_USDC.address,
    payTo: input.payTo,
    maxTimeoutSeconds: 120,
    // permit2 is required: without it a client defaults to EIP-3009, which m.USDC cannot do. The proxy is
    // the spender a payer signs for on Metis (the canonical one cannot execute there).
    extra: { assetTransferMethod: "permit2", permit2Proxy: input.proxy },
  };
}

export interface MetisChallenge {
  x402Version: 2;
  error: string;
  resource: { url: string; description: string; mimeType: string };
  accepts: PaymentRequirementsWire[];
}

export function metisChallenge(service: PricedService, resourceUrl: string, requirements: PaymentRequirementsWire): MetisChallenge {
  return { x402Version: 2, error: "Payment required", resource: { url: resourceUrl, description: service.summary, mimeType: "application/json" }, accepts: [requirements] };
}

/** The header names a client may carry the payment in (transports-v2/http.md names PAYMENT-SIGNATURE). */
export const METIS_PAYMENT_HEADERS = ["payment-signature", "x-payment", "payment", "payment-sig"] as const;

/** The presented payment payload, decoded from base64 (or bare) JSON, or null when none is presented. */
export function readMetisPayment(headers: Headers): Record<string, unknown> | null {
  for (const name of METIS_PAYMENT_HEADERS) {
    const raw = headers.get(name)?.trim();
    if (!raw) continue;
    for (const text of [raw, Buffer.from(raw, "base64").toString("utf8")]) {
      try {
        const v = JSON.parse(text) as unknown;
        if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
      } catch {
        /* try the other decoding */
      }
    }
  }
  return null;
}

export type SellerGate =
  | { kind: "closed"; status: 404 | 503; message: string }
  | { kind: "challenge"; challenge: MetisChallenge; service: PricedService }
  | { kind: "rejected"; reason: string; message: string; challenge: MetisChallenge; service: PricedService; settlement?: SettleResponse }
  | { kind: "paid"; payer: string; settlement: SettleResponse; service: PricedService };

/**
 * The gate in front of one paid tool on Metis. A decision, not a Response, so the route owns its
 * shapes. Settles BEFORE serving: the work is done only for money that has moved.
 */
export async function metisSellerGate(tool: string, headers: Headers, resourceUrl: string): Promise<SellerGate> {
  const service = serviceOf(tool);
  if (!service) return { kind: "closed", status: 404, message: "This tool isn't sold on Metis." };
  const ready = await facilitatorReady();
  if (!ready.ok) return { kind: "closed", status: ready.status, message: ready.message };
  const payTo = metisSellerPayTo();
  if (!payTo) return { kind: "closed", status: 503, message: "Sage has no address to be paid at on Metis yet." };

  const requirements = metisRequirements({ priceUsd: service.priceUsd, payTo, proxy: ready.config.proxy });
  const challenge = metisChallenge(service, resourceUrl, requirements);
  const paymentPayload = readMetisPayment(headers);
  if (!paymentPayload) return { kind: "challenge", challenge, service };

  // The requirements are OURS, never the caller's: a payload that signed for anything else fails here.
  const body = { x402Version: 2, paymentPayload, paymentRequirements: requirements };
  const verified = await verifyPayment(body, verifyDepsFor(ready.config, ready.chain));
  if (!verified.isValid) {
    return { kind: "rejected", reason: verified.invalidReason ?? "invalid_payment", message: verified.invalidMessage ?? "The payment didn't verify.", challenge, service };
  }
  const settled = await settlePayment(body, settleDepsFor(ready.config, ready.chain));
  if (!settled.success) {
    return { kind: "rejected", reason: settled.errorReason ?? "settlement_failed", message: settled.errorMessage ?? "The payment didn't settle.", challenge, service, settlement: settled };
  }
  return { kind: "paid", payer: settled.payer ?? verified.payer ?? "", settlement: settled, service };
}

export const encodeHeader = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString("base64");
