import "server-only";

import {
  buildOkxChallenge,
  encodeChallenge,
  okxPayTo,
  priceToMinimal,
  readPaymentHeader,
  verifyOkxPayment,
  OKX_ASSET,
  OKX_ASSET_SYMBOL,
  OKX_MAX_TIMEOUT_SECONDS,
  OKX_NETWORK,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  type X402Challenge,
} from "./okx";
import { claimPayment } from "./okx-store";
import { priceOf, serviceEndpoint, type PricedService } from "@/lib/mcp/pricing";

/**
 * The gate in front of one paid marketplace service.
 *
 * It is deliberately a decision rather than a wrapper that returns a Response, so the route keeps
 * ownership of its own shapes and this stays testable without HTTP.
 *
 * THREE OUTCOMES, and the difference between the last two matters. "Serve" means a valid, unused
 * authorization for the full price was presented. "Challenge" means none was presented at all, which
 * is the normal first request and not an error. "Rejected" means one was presented and something was
 * wrong with it, and the caller is told exactly what, because a buyer whose payment we refuse
 * deserves better than a repeated bill.
 */

export type PaywallDecision =
  | { kind: "serve"; payer: string; free?: false }
  | { kind: "serve"; free: true }
  | { kind: "challenge"; challenge: X402Challenge; service: PricedService }
  | { kind: "rejected"; reason: string; challenge: X402Challenge; service: PricedService };

export async function okxPaywall(
  tool: string,
  headers: Headers,
  origin: string,
): Promise<PaywallDecision> {
  const service = priceOf(tool);
  if (!service) return { kind: "serve", free: true };

  const payTo = okxPayTo();
  // No address to be paid at means there is nothing to verify against. Serving free and saying so
  // is the honest failure; presenting a bill nobody can pay is not.
  if (!payTo) return { kind: "serve", free: true };

  const challenge = buildOkxChallenge({
    resourceUrl: serviceEndpoint(tool, origin),
    description: service.summary,
    priceUsd: service.priceUsd,
    payTo,
  });

  const header = readPaymentHeader(headers);
  if (!header) return { kind: "challenge", challenge, service };

  const verdict = await verifyOkxPayment(header, {
    payTo,
    minAmount: priceToMinimal(service.priceUsd),
  });
  if (!verdict.ok) {
    // A REFUSED PAYMENT IS THE ONLY EVIDENCE WE GET about a rail we do not control, so it is worth
    // one line. The listing sat rejected while all four services answered every probe correctly;
    // what the probes were actually being told had to be reconstructed from nginx response sizes.
    // Signature excluded by construction — see ObservedPayment.
    console.warn(
      `[okx-x402] refused ${tool}: ${verdict.reason} · observed ${JSON.stringify(verdict.observed ?? null)} · expected payTo ${payTo}`,
    );
    return { kind: "rejected", reason: verdict.reason, challenge, service };
  }

  // Verified, but not yet spent. The claim is what makes it spent, and it is what stops the same
  // authorization from buying a second call.
  const claim = claimPayment({
    nonce: verdict.nonce,
    tool,
    payer: verdict.payer,
    payTo,
    auth: verdict.auth,
    // The real signature, not the header wrapper: this row must stay redeemable on its own.
    signature: verdict.signature,
  });
  if (!claim.claimed) return { kind: "rejected", reason: claim.reason, challenge, service };

  return { kind: "serve", payer: verdict.payer };
}

/** The 402 body. Human-readable first, protocol fields alongside, so both kinds of caller can read it. */
export function challengeBody(
  service: PricedService,
  challenge: X402Challenge,
  problem?: string,
): Record<string, unknown> {
  return {
    error: "payment_required",
    message:
      problem ??
      `Sage's "${service.serviceName}" runs on payment. Sign the authorization below and call again with it in the PAYMENT header.`,
    service: service.serviceName,
    tool: service.tool,
    ...(problem ? { rejected: problem } : {}),
    payment: {
      standard: "x402",
      scheme: "exact",
      network: OKX_NETWORK,
      asset: OKX_ASSET,
      assetSymbol: OKX_ASSET_SYMBOL,
      receiver: challenge.accepts[0]!.payTo,
      header: "PAYMENT",
      responseHeader: "PAYMENT-RESPONSE",
      maxTimeoutSeconds: OKX_MAX_TIMEOUT_SECONDS,
      price: `$${service.priceUsd}`,
    },
    // The protocol fields, in the body as well as the header, because clients read one or the other.
    x402Version: challenge.x402Version,
    accepts: challenge.accepts,
    resource: challenge.resource,
    // A 402 is the correct answer here, not a fault, so say what to do with it. Anyone reaching this
    // by hand has a working service in front of them and no way to tell that from a broken one.
    howToPay: {
      protocol:
        "Sign the accepts[0] entry as an EIP-3009 TransferWithAuthorization, then repeat this same request with the signed authorization in the PAYMENT header.",
      okxClient: `onchainos agent x402-check --endpoint ${challenge.resource.url}`,
      free: "Every Sage tool is also callable free, under per-caller caps, over MCP at https://sagepays.xyz/mcp/public",
    },
  };
}

/** Headers for a 402 response. */
export function challengeHeaders(challenge: X402Challenge): Record<string, string> {
  return { [PAYMENT_REQUIRED_HEADER]: encodeChallenge(challenge) };
}

/** Header acknowledging an accepted payment on a served response. */
export function paidHeaders(payer: string): Record<string, string> {
  return {
    [PAYMENT_RESPONSE_HEADER]: Buffer.from(
      JSON.stringify({ success: true, payer, network: OKX_NETWORK }),
    ).toString("base64"),
    "x-x402": "paid",
  };
}
