import "server-only";

import { GoatX402Client } from "goatx402-sdk-server";
import { x402Env } from "./facilitator";

/**
 * The merchant-side GoatX402 client (HMAC-authed to the facilitator). It creates
 * orders, polls status, and fetches signed proofs — the SDK handles the
 * X-API-Key / X-Timestamp / X-Nonce / X-Sign signing internally. Returns null
 * unless the merchant credentials are present, so callers can't use it off-rail.
 */
export function goatClient(): GoatX402Client | null {
  const env = x402Env();
  if (!env) return null;
  return new GoatX402Client({
    baseUrl: env.apiUrl,
    apiKey: env.apiKey,
    apiSecret: env.apiSecret,
  });
}
