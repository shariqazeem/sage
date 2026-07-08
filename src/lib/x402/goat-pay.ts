import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseUnits,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  GOAT_CHAIN_ID,
  GOAT_EXPLORER,
  GOAT_RPC_URL,
  GOAT_USDC,
  USDC_DECIMALS,
} from "./facilitator";

/** GOAT mainnet — native gas is BTC. */
export const goatChain = defineChain({
  id: GOAT_CHAIN_ID,
  name: "GOAT Network",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [GOAT_RPC_URL] } },
  blockExplorers: { default: { name: "GOAT Explorer", url: GOAT_EXPLORER } },
});

const erc20Abi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * Load the agent (stipend) key that pays every x402 movement — the dedicated
 * GOAT_AGENT_PRIVATE_KEY. Sourced from env, else contracts/.env (gitignored),
 * preferring the dedicated agent key. Server-only; never logged, never returned.
 */
function loadAgentKey(): `0x${string}` {
  let raw = process.env.GOAT_AGENT_PRIVATE_KEY;
  if (!raw) {
    try {
      const text = readFileSync(join(process.cwd(), "contracts", ".env"), "utf8");
      const found: Record<string, string> = {};
      for (const line of text.split(/\r?\n/)) {
        const m = /^\s*(GOAT_AGENT_PRIVATE_KEY|OPERATOR_PRIVATE_KEY|PRIVATE_KEY)\s*=\s*(.+?)\s*$/.exec(
          line,
        );
        if (m) found[m[1]] = m[2];
      }
      raw =
        found.GOAT_AGENT_PRIVATE_KEY ||
        found.OPERATOR_PRIVATE_KEY ||
        found.PRIVATE_KEY;
    } catch {
      /* no contracts/.env */
    }
  }
  if (!raw) {
    throw new Error(
      "x402 payer key not configured (set GOAT_AGENT_PRIVATE_KEY, or contracts/.env).",
    );
  }
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

let cachedAccount: PrivateKeyAccount | undefined;
function agentAccount(): PrivateKeyAccount {
  if (!cachedAccount) cachedAccount = privateKeyToAccount(loadAgentKey());
  return cachedAccount;
}

/** The agent (payer) address — the `fromAddress` in every x402 order. */
export function agentAddress(): Address {
  return agentAccount().address;
}

/** Whether the agent key is present (so a payment can actually execute). */
export function hasAgentKey(): boolean {
  try {
    loadAgentKey();
    return true;
  } catch {
    return false;
  }
}

export function usdToWei(usd: number): bigint {
  return parseUnits(String(usd), USDC_DECIMALS);
}

/** 0.1 USDC → "100000" (the atomic-units string the facilitator expects). */
export function usdToWeiString(usd: number): string {
  return usdToWei(usd).toString();
}

function goatPublicClient() {
  return createPublicClient({ chain: goatChain, transport: http(GOAT_RPC_URL) });
}

let cachedWallet: ReturnType<typeof createWalletClient> | undefined;
function goatWalletClient() {
  if (!cachedWallet) {
    cachedWallet = createWalletClient({
      account: agentAccount(),
      chain: goatChain,
      transport: http(GOAT_RPC_URL),
    });
  }
  return cachedWallet;
}

export interface UsdcTransferResult {
  txHash: Hash;
  explorerUrl: string;
}

/**
 * The real, load-bearing payment: transfer `amountWei` GOAT USDC to `payTo` from
 * the agent wallet (the ERC20_DIRECT / "transfer" x402 flow), and await the
 * receipt. Throws on any failure — callers decide whether that's fatal (the
 * verification payer) or swallowed (the operator fee). Never simulated.
 */
export async function transferUsdc(
  payTo: Address | string,
  amountWei: bigint | string,
): Promise<UsdcTransferResult> {
  const to = getAddress(payTo);
  const amount = typeof amountWei === "bigint" ? amountWei : BigInt(amountWei);
  const wallet = goatWalletClient();
  const pub = goatPublicClient();

  const txHash = await wallet.writeContract({
    address: getAddress(GOAT_USDC),
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
    account: agentAccount(),
    chain: goatChain,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`USDC transfer reverted (tx ${txHash}).`);
  }
  return { txHash, explorerUrl: `${GOAT_EXPLORER}/tx/${txHash}` };
}

/** Agent-wallet USDC balance in whole tokens (for the activation checklist / UI). */
export async function agentUsdcBalance(): Promise<number> {
  const bal = (await goatPublicClient().readContract({
    address: getAddress(GOAT_USDC),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [agentAddress()],
  })) as bigint;
  return Number(bal) / 10 ** USDC_DECIMALS;
}
