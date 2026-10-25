import "server-only";

import { getAddress, isAddress, type Address, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { M_USDC, M_USDT, METIS_DEFAULT_RPC } from "./constants";

/**
 * THE GATE. The Metis facilitator relays signed payments that move other people's money, so it is
 * OFF unless every one of these is set:
 *
 *   X402_METIS_ENABLED="1"                the switch; anything else and the routes answer 404
 *   X402_METIS_FACILITATOR_PRIVATE_KEY    the key that pays the gas for settle transactions
 *   X402_METIS_PERMIT2_PROXY_ADDRESS      the x402ExactPermit2Proxy payers name as spender
 *
 * Enabled but incomplete answers 503 and names what is missing, never what is set. The proxy is then
 * checked on chain (http.ts, proxy-core.ts) before a single payment is looked at.
 *
 * Optional:
 *   METIS_MAINNET_RPC_URL                 default https://andromeda.metis.io/?owner=1088
 *   X402_METIS_PAY_TO_ALLOWLIST           who the facilitator settles for. Unset: Sage's own payee only
 *                                         (metisSellerPayTo), so Sage never pays the gas for someone
 *                                         else's sale unless the founder chooses to (24 Oct 2026: "we can't
 *                                         afford to pay everyone's"). A comma-separated list names the
 *                                         payees; "*" settles for anyone.
 *   X402_METIS_ACCEPT_USDT="1"            also settle m.USDT (m.USDC always)
 *   X402_METIS_DAILY_SETTLE_CAP           broadcasts per day, default 500: bounds the gas a public
 *                                         /settle can spend
 *
 * THE KEY. It is read here, turned into a viem account, and never stored, returned, logged or put in
 * a message. The account object holds signing functions, not the key.
 */

export interface MetisFacilitatorConfig {
  account: LocalAccount;
  proxy: Address;
  rpcUrl: string;
  assets: readonly Address[];
  payToAllowlist: readonly Address[] | null;
  dailySettleCap: number;
}

export type ConfigGate =
  | { open: true; config: MetisFacilitatorConfig }
  | { open: false; status: 404 | 503; message: string };

export const DEFAULT_DAILY_SETTLE_CAP = 500;

/**
 * Keys that already sign for another part of Sage. The facilitator must have its own: one key is one
 * nonce sequence, and two senders racing on it drop each other's transactions, a settlement here or
 * a payout there.
 */
const OTHER_SIGNING_KEYS = [
  "GOAT_AGENT_PRIVATE_KEY",
  "OPERATOR_PRIVATE_KEY",
  "METIS_MAINNET_OPERATOR_PRIVATE_KEY",
  "ARC_OPERATOR_PRIVATE_KEY",
  "ARC_MAINNET_OPERATOR_PRIVATE_KEY",
] as const;

/**
 * The address Sage is paid at on Metis, or null: `X402_METIS_PAY_TO`, else the billing address. The
 * seller asks to be paid here, and an unset allowlist settles for this address alone.
 */
export function metisSellerPayTo(env: Readonly<Record<string, string | undefined>> = process.env): Address | null {
  for (const raw of [env.X402_METIS_PAY_TO, env.SAGE_BILLING_ADDRESS]) {
    const v = raw?.trim();
    if (v && isAddress(v)) return getAddress(v);
  }
  return null;
}

const normKey = (k: string): string => (k.startsWith("0x") || k.startsWith("0X") ? k.slice(2) : k).toLowerCase();

export function readFacilitatorConfig(env: Readonly<Record<string, string | undefined>> = process.env): ConfigGate {
  if (env.X402_METIS_ENABLED?.trim() !== "1") return { open: false, status: 404, message: "Not found" };

  const problems: string[] = [];

  let account: LocalAccount | null = null;
  const rawKey = env.X402_METIS_FACILITATOR_PRIVATE_KEY?.trim();
  if (!rawKey) {
    problems.push("X402_METIS_FACILITATOR_PRIVATE_KEY is not set");
  } else if (!/^[0-9a-f]{64}$/.test(normKey(rawKey))) {
    problems.push("X402_METIS_FACILITATOR_PRIVATE_KEY is not a 32-byte hex key");
  } else if (
    OTHER_SIGNING_KEYS.some((name) => {
      const other = env[name]?.trim();
      return !!other && normKey(other) === normKey(rawKey);
    })
  ) {
    problems.push("X402_METIS_FACILITATOR_PRIVATE_KEY must be its own key, not one Sage already signs payouts with");
  } else {
    try {
      account = privateKeyToAccount(`0x${normKey(rawKey)}`);
    } catch {
      problems.push("X402_METIS_FACILITATOR_PRIVATE_KEY is not a valid secp256k1 key");
    }
  }

  const rawProxy = env.X402_METIS_PERMIT2_PROXY_ADDRESS?.trim();
  if (!rawProxy) problems.push("X402_METIS_PERMIT2_PROXY_ADDRESS is not set");
  else if (!isAddress(rawProxy, { strict: false })) problems.push("X402_METIS_PERMIT2_PROXY_ADDRESS is not an address");

  const rpcUrl = env.METIS_MAINNET_RPC_URL?.trim() || METIS_DEFAULT_RPC;
  if (!/^https?:\/\//.test(rpcUrl)) problems.push("METIS_MAINNET_RPC_URL is not an http(s) URL");

  // Unset: Sage's own payee alone (none yet: nothing settles). "*": anyone, and Sage pays their gas.
  const sagePayee = metisSellerPayTo(env);
  let payToAllowlist: Address[] | null = sagePayee ? [sagePayee] : [];
  const rawList = env.X402_METIS_PAY_TO_ALLOWLIST?.trim();
  if (rawList === "*") {
    payToAllowlist = null;
  } else if (rawList) {
    const entries = rawList.split(/[\s,]+/).filter(Boolean);
    if (entries.some((e) => !isAddress(e, { strict: false }))) {
      problems.push("X402_METIS_PAY_TO_ALLOWLIST has an entry that is not an address");
    } else {
      payToAllowlist = entries.map((e) => getAddress(e));
    }
  }

  let dailySettleCap = DEFAULT_DAILY_SETTLE_CAP;
  const rawCap = env.X402_METIS_DAILY_SETTLE_CAP?.trim();
  if (rawCap) {
    const n = Number(rawCap);
    if (!Number.isInteger(n) || n <= 0) problems.push("X402_METIS_DAILY_SETTLE_CAP is not a positive integer");
    else dailySettleCap = n;
  }

  if (problems.length > 0 || !account || !rawProxy) {
    return {
      open: false,
      status: 503,
      message: `x402 on Metis is switched on but not configured: ${problems.join("; ")}`,
    };
  }

  const assets = env.X402_METIS_ACCEPT_USDT?.trim() === "1" ? [M_USDC.address, M_USDT.address] : [M_USDC.address];
  return {
    open: true,
    config: { account, proxy: getAddress(rawProxy), rpcUrl, assets, payToAllowlist, dailySettleCap },
  };
}
