import "server-only";

/**
 * Privy server-wallet client — the agent's OWN on-chain wallet, custodied + policy-guarded by
 * Privy. Sage never holds the raw key: it asks Privy to create wallets, attaches spend policies
 * (the founder's mandate — per-tx cap + an allowlist of Sage's own contracts), and asks Privy to
 * SIGN transactions. Sage then broadcasts the signed tx over the GOAT RPC it already runs.
 *
 * The safety model is deterministic and lives at Privy: a transaction outside the attached policy
 * (over the per-tx cap, or to a non-allowlisted address) is refused HERE, before it is ever signed
 * — independent of anything the agent's LLM decided. Proven working against Privy 2026-07-15
 * (create wallet + eth_signTransaction on GOAT chainId 2345).
 */

const API = "https://api.privy.io/v1";
const GOAT_CHAIN_ID = 2345;
const TIMEOUT_MS = 20_000;

function creds(): { id: string; secret: string } | null {
  const id = process.env.PRIVY_APP_ID?.trim();
  const secret = process.env.PRIVY_APP_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

/** Whether the agent-wallet layer is configured (a Privy app is wired). */
export function privyConfigured(): boolean {
  return !!creds();
}

/** One authenticated request to the Privy REST API (Basic app_id:app_secret + the app-id header). */
async function privyRequest<T>(method: "POST" | "PATCH", path: string, body: unknown): Promise<T> {
  const c = creds();
  if (!c) throw new Error("Privy not configured (PRIVY_APP_ID / PRIVY_APP_SECRET unset)");
  const auth = Buffer.from(`${c.id}:${c.secret}`).toString("base64");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      "privy-app-id": c.id,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`privy ${res.status}: ${JSON.stringify(json).slice(0, 240)}`);
  }
  return json as T;
}

export const privyPost = <T>(path: string, body: unknown): Promise<T> => privyRequest<T>("POST", path, body);
export const privyPatch = <T>(path: string, body: unknown): Promise<T> => privyRequest<T>("PATCH", path, body);

/** Swap the single policy enforced on an existing wallet (Privy allows one policy per wallet). Used
 *  to briefly grant a scoped, one-target withdraw permit, then re-lock to the base mandate. */
export async function setWalletPolicies(walletId: string, policyIds: string[]): Promise<void> {
  await privyPatch(`/wallets/${walletId}`, { policy_ids: policyIds });
}

export interface ServerWallet {
  id: string;
  address: `0x${string}`;
}

/** Create a fresh EVM server wallet (one per founder), with the founder's mandate policies attached
 *  at birth so the wallet can never sign outside them. */
export async function createServerWallet(policyIds: string[] = []): Promise<ServerWallet> {
  const w = await privyPost<{ id: string; address: string }>("/wallets", {
    chain_type: "ethereum",
    ...(policyIds.length ? { policy_ids: policyIds } : {}),
  });
  return { id: w.id, address: w.address as `0x${string}` };
}

/** The unsigned transaction fields Privy signs. Populate nonce/gas from the live GOAT client; the
 *  chain id is forced to GOAT here so a caller can never sign for the wrong network. */
export interface EvmTxRequest {
  to: `0x${string}`;
  value?: `0x${string}`;
  data?: `0x${string}`;
  nonce: `0x${string}`;
  gas_limit: `0x${string}`;
  max_fee_per_gas?: `0x${string}`;
  max_priority_fee_per_gas?: `0x${string}`;
  /** Legacy fallback — GOAT accepts EIP-1559 but some nodes want legacy gas. */
  gas_price?: `0x${string}`;
}

/**
 * Sign a GOAT (chainId 2345) transaction with the wallet and return the raw signed tx for Sage to
 * broadcast. Privy's attached policy gates this: a spend over the cap or to a non-allowlisted
 * address throws here instead of returning a signature.
 */
export async function signGoatTransaction(walletId: string, tx: EvmTxRequest): Promise<`0x${string}`> {
  const r = await privyPost<{ data?: { signed_transaction?: string } }>(`/wallets/${walletId}/rpc`, {
    method: "eth_signTransaction",
    params: { transaction: { ...tx, chain_id: GOAT_CHAIN_ID } },
  });
  const signed = r.data?.signed_transaction;
  if (!signed) throw new Error("privy: eth_signTransaction returned no signed_transaction");
  return signed as `0x${string}`;
}
