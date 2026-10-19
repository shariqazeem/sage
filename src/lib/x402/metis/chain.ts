import "server-only";

import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  ExecutionRevertedError,
  createPublicClient,
  defineChain,
  http,
  keccak256,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { ERC20_ABI, EXACT_PROXY_ABI, METIS_CHAIN_ID, METIS_EXPLORER, PERMIT2_ABI, PERMIT2_ADDRESS } from "./constants";
import type { ProxyProbe } from "./proxy-core";
import type { ReceiptFact } from "./settle-core";

/**
 * EVERY READ AND WRITE THE FACILITATOR MAKES ON METIS, behind one interface so the orchestrators
 * test against a fake chain with no network.
 *
 * Two kinds of failure are kept apart on purpose. A revert is an answer: the chain looked at the
 * call and refused it, and that comes back as data (null, or `ok: false` with the revert bytes). A
 * transport failure (the RPC is down, the request timed out) is not an answer, and it throws, so a
 * payment is never judged invalid because the node did not reply.
 */
export interface MetisChain {
  chainId(): Promise<number>;
  /** keccak256 of the code at `address`, or null when there is none. */
  codeHash(address: Address): Promise<Hex | null>;
  hasCode(address: Address): Promise<boolean>;
  permit2DomainSeparator(): Promise<Hex | null>;
  proxyPermit2(proxy: Address): Promise<Address | null>;
  proxyWitnessTypehash(proxy: Address): Promise<Hex | null>;
  proxyWitnessTypeString(proxy: Address): Promise<string | null>;
  balanceOf(token: Address, owner: Address): Promise<bigint>;
  allowance(token: Address, owner: Address, spender: Address): Promise<bigint>;
  nonceBitmap(owner: Address, wordPos: bigint): Promise<bigint>;
  /** eth_call `data` to `to` from `from`. */
  simulate(from: Address, to: Address, data: Hex): Promise<{ ok: true } | { ok: false; revertData?: Hex }>;
  estimateGas(from: Address, to: Address, data: Hex): Promise<bigint>;
  gasPrice(): Promise<bigint>;
  nativeBalance(address: Address): Promise<bigint>;
  transactionCount(address: Address, blockTag: "latest" | "pending"): Promise<number>;
  sendRawTransaction(serialized: Hex): Promise<Hex>;
  /** Wait up to `timeoutMs` for a receipt; `unknown` if none came. */
  waitForReceipt(hash: Hex, timeoutMs: number): Promise<ReceiptFact>;
  /** The receipt if the node has one now; `unknown` otherwise. */
  receipt(hash: Hex): Promise<ReceiptFact>;
}

/**
 * Whether an error is the chain refusing the call. Measured on the Andromeda RPC (19 Oct 2026): a
 * reverted eth_call surfaces as CallExecutionError → ExecutionRevertedError → RpcRequestError (code 3,
 * with the revert bytes as `data`); a reverted view adds ContractFunctionRevertedError on top; an
 * unreachable RPC surfaces as HttpRequestError. Only the first kind is an answer; everything else,
 * including any JSON-RPC error this code does not recognize, throws.
 */
function isRevert(e: unknown): boolean {
  return (
    e instanceof BaseError &&
    e.walk(
      (x) =>
        x instanceof ExecutionRevertedError ||
        x instanceof ContractFunctionRevertedError ||
        x instanceof ContractFunctionZeroDataError,
    ) !== null
  );
}

function revertDataOf(e: unknown): Hex | undefined {
  if (!(e instanceof BaseError)) return undefined;
  const carrier = e.walk((x) => typeof (x as { data?: unknown }).data === "string");
  const data = carrier ? (carrier as { data?: unknown }).data : undefined;
  return typeof data === "string" && /^0x[0-9a-fA-F]*$/.test(data) ? (data as Hex) : undefined;
}

/** A view call: its result, or null if it reverted. Anything else throws. */
async function view<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (e) {
    if (!isRevert(e)) throw e;
    return null;
  }
}

function receiptFact(r: TransactionReceipt): ReceiptFact {
  if (r.status !== "success") return { status: "reverted" };
  return { status: "success", logs: r.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data })) };
}

export function metisChain(rpcUrl: string): MetisChain {
  const chain = defineChain({
    id: METIS_CHAIN_ID,
    name: "Metis Andromeda",
    nativeCurrency: { name: "Metis", symbol: "METIS", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "Metis Explorer", url: METIS_EXPLORER } },
  });
  const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }) });

  return {
    chainId: () => client.getChainId(),
    async codeHash(address) {
      const code = await client.getCode({ address });
      return code && code !== "0x" ? keccak256(code) : null;
    },
    async hasCode(address) {
      const code = await client.getCode({ address });
      return !!code && code !== "0x";
    },
    permit2DomainSeparator: () =>
      view(() => client.readContract({ address: PERMIT2_ADDRESS, abi: PERMIT2_ABI, functionName: "DOMAIN_SEPARATOR" })),
    proxyPermit2: (proxy) =>
      view(() => client.readContract({ address: proxy, abi: EXACT_PROXY_ABI, functionName: "PERMIT2" })),
    proxyWitnessTypehash: (proxy) =>
      view(() => client.readContract({ address: proxy, abi: EXACT_PROXY_ABI, functionName: "WITNESS_TYPEHASH" })),
    proxyWitnessTypeString: (proxy) =>
      view(() => client.readContract({ address: proxy, abi: EXACT_PROXY_ABI, functionName: "WITNESS_TYPE_STRING" })),
    balanceOf: (token, owner) =>
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] }),
    allowance: (token, owner, spender) =>
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [owner, spender] }),
    nonceBitmap: (owner, wordPos) =>
      client.readContract({ address: PERMIT2_ADDRESS, abi: PERMIT2_ABI, functionName: "nonceBitmap", args: [owner, wordPos] }),
    async simulate(from, to, data) {
      try {
        await client.call({ account: from, to, data });
        return { ok: true };
      } catch (e) {
        if (!isRevert(e)) throw e;
        return { ok: false, revertData: revertDataOf(e) };
      }
    },
    estimateGas: (from, to, data) => client.estimateGas({ account: from, to, data }),
    gasPrice: () => client.getGasPrice(),
    nativeBalance: (address) => client.getBalance({ address }),
    transactionCount: (address, blockTag) => client.getTransactionCount({ address, blockTag }),
    sendRawTransaction: (serialized) => client.sendRawTransaction({ serializedTransaction: serialized }),
    async waitForReceipt(hash, timeoutMs) {
      try {
        return receiptFact(await client.waitForTransactionReceipt({ hash, timeout: timeoutMs, pollingInterval: 2_000 }));
      } catch {
        return { status: "unknown" };
      }
    },
    async receipt(hash) {
      try {
        return receiptFact(await client.getTransactionReceipt({ hash }));
      } catch {
        return { status: "unknown" };
      }
    },
  };
}

/** Read everything proxy-core.ts judges. */
export async function probeProxy(chain: MetisChain, proxy: Address): Promise<ProxyProbe> {
  const [chainId, proxyCodeHash, permit2HasCode, permit2DomainSeparator] = await Promise.all([
    chain.chainId(),
    chain.codeHash(proxy),
    chain.hasCode(PERMIT2_ADDRESS),
    chain.permit2DomainSeparator(),
  ]);
  if (proxyCodeHash === null) {
    return {
      chainId,
      proxyCodeHash,
      permit2HasCode,
      permit2DomainSeparator,
      proxyPermit2: null,
      proxyWitnessTypehash: null,
      proxyWitnessTypeString: null,
    };
  }
  const [proxyPermit2, proxyWitnessTypehash, proxyWitnessTypeString] = await Promise.all([
    chain.proxyPermit2(proxy),
    chain.proxyWitnessTypehash(proxy),
    chain.proxyWitnessTypeString(proxy),
  ]);
  return {
    chainId,
    proxyCodeHash,
    permit2HasCode,
    permit2DomainSeparator,
    proxyPermit2,
    proxyWitnessTypehash,
    proxyWitnessTypeString,
  };
}
