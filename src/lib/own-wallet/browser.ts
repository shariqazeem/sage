import { createPublicClient, http, parseAbi, parseTransaction, recoverTransactionAddress, type Hex, type TransactionSerialized } from "viem";

import { viemChainFor } from "@/lib/deputy/networks";
import { sameChainAddress } from "@/lib/campaigns/chain-address";
import { legacyRpcTx, metisAddChainParams, OWN_WALLET_CHAIN_ID, VAULT_STATES, type LegacyTx, type OwnWalletChainState, type OwnWalletParams, type OwnWalletStep } from "./plan";
import type { OwnWalletIO, TxStatus } from "./run";

/**
 * THE BROWSER'S HANDS: reading Metis, and asking a wallet to sign. Two wallets, one shape:
 * - an injected wallet (MetaMask, Rabby): `eth_sendTransaction` with `type: "0x0"` and a `gasPrice`;
 * - a Privy embedded wallet (an email sign-in): `eth_signTransaction` for the same type-0 transaction,
 *   the signed bytes CHECKED here (type 0, this chain, this call, this signer), then broadcast by this
 *   page to Metis. The embedded wallet's own send path prices a transaction itself, and Metis rejects
 *   the EIP-1559 shape; signing the exact bytes and sending them ourselves is the route the server-side
 *   executor already takes with Privy on Metis.
 */

/** The least of EIP-1193 this needs. */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

const VAULT_ABI = parseAbi(["function getState() view returns (uint8)"]);
const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address owner, address spender) view returns (uint256)"]);

type MetisClient = ReturnType<typeof createPublicClient>;
let client: MetisClient | null = null;
/** One read client for Metis's public endpoint (the same one a wallet is told about). */
export function metisPublicClient(): MetisClient {
  return (client ??= createPublicClient({ chain: viemChainFor(OWN_WALLET_CHAIN_ID), transport: http() }));
}

/** Everything the next step depends on, read fresh from Metis. */
export async function readOwnWalletState(params: OwnWalletParams, pub: MetisClient = metisPublicClient()): Promise<OwnWalletChainState> {
  const [code, allowanceBase, usdcBase, nativeWei, gasPriceWei] = await Promise.all([
    pub.getCode({ address: params.vault }),
    pub.readContract({ address: params.token, abi: ERC20_ABI, functionName: "allowance", args: [params.owner, params.vault] }),
    pub.readContract({ address: params.token, abi: ERC20_ABI, functionName: "balanceOf", args: [params.owner] }),
    pub.getBalance({ address: params.owner }),
    pub.getGasPrice(),
  ]);
  const vaultExists = !!code && code !== "0x";
  const raw = vaultExists ? Number(await pub.readContract({ address: params.vault, abi: VAULT_ABI, functionName: "getState" })) : null;
  return { vaultExists, vaultState: raw === null ? null : (VAULT_STATES[raw] ?? null), allowanceBase, usdcBase, nativeWei, gasPriceWei };
}

async function txStatus(pub: MetisClient, hash: Hex): Promise<TxStatus> {
  try {
    return (await pub.getTransactionReceipt({ hash })).status === "success" ? "success" : "reverted";
  } catch {
    try {
      await pub.getTransaction({ hash });
      return "pending";
    } catch {
      return "unknown";
    }
  }
}

/** Put the wallet on Metis, teaching it the network when it doesn't know it. A decline is thrown as it is. */
export async function ensureMetis(provider: Eip1193): Promise<void> {
  const want = metisAddChainParams();
  const current = async (): Promise<number | null> => {
    try {
      return parseInt(String(await provider.request({ method: "eth_chainId" })), 16);
    } catch {
      return null;
    }
  };
  if ((await current()) === OWN_WALLET_CHAIN_ID) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want.chainId }] });
  } catch (e) {
    if ((e as { code?: number } | null)?.code === 4001) throw e; // "no" is an answer: no second prompt
    await provider.request({ method: "wallet_addEthereumChain", params: [want] });
  }
  if ((await current()) !== OWN_WALLET_CHAIN_ID) throw new Error("Your wallet isn't on the Metis network. Switch it to Metis and continue.");
}

/** An injected wallet sends the type-0 transaction itself. */
export function injectedSender(provider: Eip1193): (tx: LegacyTx) => Promise<Hex> {
  return async (tx) => {
    await ensureMetis(provider);
    return (await provider.request({ method: "eth_sendTransaction", params: [legacyRpcTx(tx)] })) as Hex;
  };
}

/**
 * THE SIGNED BYTES ARE WHAT WAS ASKED FOR, or they are not broadcast. A wallet that returned an EIP-1559
 * transaction, another chain's, another call's, or one signed by a different key is refused here, before
 * Metis ever sees it.
 */
export async function assertSignedLegacy(raw: Hex, tx: LegacyTx, nonce: number): Promise<void> {
  const parsed = parseTransaction(raw);
  const wrong = (what: string): never => {
    throw new Error(`Your wallet signed something other than what was asked (${what}). Nothing was sent.`);
  };
  if (parsed.type !== "legacy") wrong(`transaction type ${parsed.type ?? "unknown"}, and Metis only takes type 0`);
  if (parsed.chainId !== tx.chainId) wrong("the network");
  if (!parsed.to || !sameChainAddress(parsed.to, tx.to)) wrong("the contract");
  if ((parsed.data ?? "0x").toLowerCase() !== tx.data.toLowerCase()) wrong("the call");
  if ((parsed.value ?? BigInt(0)) !== BigInt(0)) wrong("a value");
  if (parsed.nonce !== nonce) wrong("the nonce");
  if (parsed.gas !== tx.gas || parsed.gasPrice !== tx.gasPrice) wrong("the fee");
  const signer = await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized<"legacy"> });
  if (!sameChainAddress(signer, tx.from)) wrong("the signer");
}

/** A Privy embedded wallet signs the exact type-0 transaction; this page checks it and broadcasts it. */
export function embeddedSender(provider: Eip1193, pub: MetisClient = metisPublicClient()): (tx: LegacyTx) => Promise<Hex> {
  const hex = (n: bigint | number): string => `0x${n.toString(16)}`;
  return async (tx) => {
    const nonce = await pub.getTransactionCount({ address: tx.from, blockTag: "pending" });
    const raw = (await provider.request({
      method: "eth_signTransaction",
      // Privy's own field names (UnsignedTransactionRequest): gasLimit, a numeric type and chainId
      params: [{ from: tx.from, to: tx.to, data: tx.data, value: "0x0", nonce, gasLimit: hex(tx.gas), gasPrice: hex(tx.gasPrice), chainId: tx.chainId, type: 0 }],
    })) as Hex;
    await assertSignedLegacy(raw, tx, nonce);
    return pub.sendRawTransaction({ serializedTransaction: raw });
  };
}

/** Transaction hashes this browser sent for a job, kept so a reload shows their links and waits for one in flight. */
export function hashMemory(jobId: string, owner: string): Pick<OwnWalletIO, "recall" | "remember"> {
  const key = `sage.own-wallet.${jobId}.${owner.toLowerCase()}`;
  const read = (): Partial<Record<OwnWalletStep, Hex>> => {
    try {
      return JSON.parse(window.localStorage.getItem(key) ?? "{}") as Partial<Record<OwnWalletStep, Hex>>;
    } catch {
      return {};
    }
  };
  return {
    recall: (step) => read()[step] ?? null,
    remember: (step, hash) => {
      try {
        const all = read();
        if (hash) all[step] = hash;
        else delete all[step];
        window.localStorage.setItem(key, JSON.stringify(all));
      } catch {
        /* a browser without storage still launches; it only loses the links on reload */
      }
    },
  };
}

/** The real `OwnWalletIO`: Metis's public node for reads, the given wallet for signatures, Sage for the record. */
export function browserOwnWalletIO(input: { jobId: string; owner: string; send: (tx: LegacyTx) => Promise<Hex> }, pub: MetisClient = metisPublicClient()): OwnWalletIO {
  return {
    ...hashMemory(input.jobId, input.owner),
    readState: (params) => readOwnWalletState(params, pub),
    estimateGas: (from, call) => pub.estimateGas({ account: from, to: call.to, data: call.data }),
    send: input.send,
    txStatus: (hash) => txStatus(pub, hash),
    waitFor: async (hash) => ((await pub.waitForTransactionReceipt({ hash, timeout: 180_000 })).status === "success" ? "success" : "reverted"),
    record: async (vault) => {
      const res = await fetch(`/api/launch/${input.jobId}/wallet/record`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vault }) });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; campaignId?: string; error?: string };
      if (res.ok && j.ok && j.campaignId) return { ok: true, campaignId: j.campaignId };
      // 503: the chain could not be read; 409 not_active/no_vault right after a confirmation is a node a block behind
      return { ok: false, error: j.error ?? "Sage couldn't record the job.", retry: res.status === 503 || res.status === 409 || res.status === 429 };
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}
