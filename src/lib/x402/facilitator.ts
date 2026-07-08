import "server-only";

/**
 * GOAT x402 config + live gate — the single source of truth for whether the two
 * x402 rails are active. Real protocol (`goatx402-sdk-server`, facilitator
 * `https://api.x402.goat.network`, GOAT mainnet chain 2345, USDC min 0.1). The
 * merchant credentials come from the GOAT merchant portal (Receive Type DIRECT).
 *
 * HONESTY: `isX402Live()` gates EVERYTHING. When false, the honest "pending
 * merchant approval" chips remain and internal calls bypass the paywall — no code
 * path may ever present a payment that didn't happen on-chain.
 */

export const GOAT_CHAIN_ID = 2345;
export const GOAT_RPC_URL = "https://rpc.goat.network";
export const GOAT_EXPLORER = "https://explorer.goat.network";
/** GOAT mainnet USDC (6 decimals). */
export const GOAT_USDC = "0x3022b87ac063DE95b1570F46f5e470F8B53112D8";
export const USDC_DECIMALS = 6;
/** Facilitator minimum payment. */
export const MIN_USDC = 0.1;
/** The verification fee + the operator fee are both the minimum. */
export const VERIFICATION_FEE_USD = 0.1;
export const OPERATOR_FEE_USD = 0.1;

const DEFAULT_API_URL = "https://x402-api.goat.network";

export interface X402Env {
  /** Facilitator base URL (defaults to the production endpoint). */
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
  merchantId: string;
}

/** Back-compat alias kept for the existing seam consumers. */
export type X402Config = X402Env;

/**
 * Read the GOAT x402 merchant credentials from env. The three portal creds
 * (KEY / SECRET / MERCHANT_ID) are required; the API URL defaults to the known
 * production facilitator when GOATX402_API_URL is unset. Returns null unless the
 * creds are present — never partially active.
 */
export function x402Env(): X402Env | null {
  const apiKey = process.env.GOATX402_API_KEY?.trim();
  const apiSecret = process.env.GOATX402_API_SECRET?.trim();
  const merchantId = process.env.GOATX402_MERCHANT_ID?.trim();
  if (!apiKey || !apiSecret || !merchantId) return null;
  const apiUrl = process.env.GOATX402_API_URL?.trim() || DEFAULT_API_URL;
  return { apiUrl, apiKey, apiSecret, merchantId };
}

/** True once the GOAT merchant credentials are present — the master gate. */
export function isX402Live(): boolean {
  return x402Env() !== null;
}

export interface X402VerificationFee {
  active: boolean;
  amountUsd: number | null;
  label: string;
}

/**
 * The verification fee the Deputy pays for gated evidence. Honest label when the
 * rail is inactive; a real amount when live.
 */
export function verificationFee(): X402VerificationFee {
  const active = isX402Live();
  return {
    active,
    amountUsd: active ? VERIFICATION_FEE_USD : null,
    label: active
      ? `x402 verification fee · ${VERIFICATION_FEE_USD} USDC`
      : "x402 verification fee — activates when GOAT merchant credentials land",
  };
}

/** A GOAT explorer link for a payment tx (real txs only ever reach the UI). */
export function goatTxUrl(txHash: string): string {
  return `${GOAT_EXPLORER}/tx/${txHash}`;
}
