import "server-only";

import { createWalletClient, erc20Abi, getAddress, http, isAddress, parseEther, type Address, type Hash, type PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainConfig, METIS_MAINNET_CHAIN_ID, viemChainFor } from "@/lib/deputy/networks";
import { publicClient, writePublicClient } from "@/lib/deputy/chain";

/**
 * THE ADVANCE POT, ON METIS (26 Oct 2026). Advances moved off Starknet with the rest of Sage. The pot is a
 * Metis wallet of its own, `ADVANCE_POT_PRIVATE_KEY` on the server, holding m.USDC to lend and a little
 * METIS for its own fees. It never shares a key with anything that pays people: one key is one nonce
 * sequence, and two senders on one key drop each other's transactions (the same rule the x402
 * facilitator's key follows).
 *
 * The pot does three things, all here: send an advance to a borrower, collect a repayment with
 * `transferFrom` under the allowance the borrower approved, and, once per borrower, cover the METIS fee of
 * that one approval. Every send goes through one queue, so the pot never races itself.
 */

export const POT_CHAIN_ID = METIS_MAINNET_CHAIN_ID;
/** Below this much METIS the pot pauses advances: it must be able to pay out, top up a fee, and collect. */
export const POT_MIN_METIS_WEI = parseEther("0.005");
/** An ERC-20 approve on Metis measures ~46k gas; this is its ceiling with headroom. */
export const APPROVAL_GAS = BigInt(60_000);
/** The most the pot sends to cover one approval's fee, whatever the gas price does. */
export const APPROVAL_FEE_CAP_WEI = parseEther("0.002");
/** Advances below this are not offered (the formula can produce cents). */
export const MIN_ADVANCE_BASE = BigInt(100_000); // $0.10

/** Keys that already sign for another part of Sage; the pot must hold its own. */
const OTHER_SIGNING_KEYS = [
  "GOAT_AGENT_PRIVATE_KEY",
  "OPERATOR_PRIVATE_KEY",
  "METIS_MAINNET_OPERATOR_PRIVATE_KEY",
  "ARC_OPERATOR_PRIVATE_KEY",
  "ARC_MAINNET_OPERATOR_PRIVATE_KEY",
  "X402_METIS_FACILITATOR_PRIVATE_KEY",
] as const;

const normKey = (k: string): string => (k.startsWith("0x") || k.startsWith("0X") ? k.slice(2) : k).toLowerCase();

export interface PotConfig {
  account: PrivateKeyAccount;
  address: Address;
  token: Address;
}

export type PotConfigResult = { ok: true; pot: PotConfig } | { ok: false; reason: "unconfigured" | "invalid"; message: string };

export function potConfig(env: Readonly<Record<string, string | undefined>> = process.env): PotConfigResult {
  const raw = env.ADVANCE_POT_PRIVATE_KEY?.trim();
  if (!raw) return { ok: false, reason: "unconfigured", message: "ADVANCE_POT_PRIVATE_KEY is not set" };
  if (!/^[0-9a-f]{64}$/.test(normKey(raw))) return { ok: false, reason: "invalid", message: "ADVANCE_POT_PRIVATE_KEY is not a 32-byte hex key" };
  if (OTHER_SIGNING_KEYS.some((name) => !!env[name]?.trim() && normKey(env[name] as string) === normKey(raw))) {
    return { ok: false, reason: "invalid", message: "ADVANCE_POT_PRIVATE_KEY must be its own key, not one Sage already signs with" };
  }
  const token = chainConfig(POT_CHAIN_ID).usdcAddress;
  if (!token || !isAddress(token)) return { ok: false, reason: "invalid", message: "Metis has no USDC configured" };
  const account = privateKeyToAccount(`0x${normKey(raw)}`);
  return { ok: true, pot: { account, address: account.address, token: getAddress(token) } };
}

/** What the pot holds now, read from the chain. */
export async function potBalances(pot: Pick<PotConfig, "address" | "token">): Promise<{ usdcBase: bigint; metisWei: bigint }> {
  const client = publicClient(POT_CHAIN_ID);
  const [usdcBase, metisWei] = await Promise.all([
    client.readContract({ address: pot.token, abi: erc20Abi, functionName: "balanceOf", args: [pot.address] }),
    client.getBalance({ address: pot.address }),
  ]);
  return { usdcBase, metisWei };
}

/** How much USDC `owner` has approved the pot to collect. */
export async function allowanceToPot(pot: Pick<PotConfig, "address" | "token">, owner: Address): Promise<bigint> {
  return publicClient(POT_CHAIN_ID).readContract({ address: pot.token, abi: erc20Abi, functionName: "allowance", args: [owner, pot.address] });
}

export async function usdcBalanceOf(pot: Pick<PotConfig, "token">, owner: Address): Promise<bigint> {
  return publicClient(POT_CHAIN_ID).readContract({ address: pot.token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

export async function metisBalanceOf(owner: Address): Promise<bigint> {
  return publicClient(POT_CHAIN_ID).getBalance({ address: owner });
}

/** What one approval costs a borrower today, capped. Metis prices gas legacy-style: +20% headroom. */
export async function approvalFeeWei(): Promise<bigint> {
  const price = ((await writePublicClient(POT_CHAIN_ID).getGasPrice()) * BigInt(12)) / BigInt(10);
  const fee = APPROVAL_GAS * price;
  return fee < APPROVAL_FEE_CAP_WEI ? fee : APPROVAL_FEE_CAP_WEI;
}

// ONE SEND AT A TIME. The self-serve door and the sweep's collector both send from the pot; serialized
// here, each send reads the pending nonce after the previous one was accepted by the node.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

function walletFor(pot: PotConfig) {
  const cfg = chainConfig(POT_CHAIN_ID);
  return createWalletClient({ account: pot.account, chain: viemChainFor(POT_CHAIN_ID), transport: http(cfg.writeRpcUrl ?? cfg.rpcUrl) });
}

async function legacyGasPrice(): Promise<bigint> {
  return ((await writePublicClient(POT_CHAIN_ID).getGasPrice()) * BigInt(12)) / BigInt(10);
}

/** Send `amountBase` m.USDC from the pot to `to`. Returns once the node accepted it (not mined). */
export function potSendUsdc(pot: PotConfig, to: Address, amountBase: bigint): Promise<Hash> {
  return serialized(async () => {
    const gasPrice = await legacyGasPrice();
    return walletFor(pot).writeContract({ address: pot.token, abi: erc20Abi, functionName: "transfer", args: [to, amountBase], gasPrice, type: "legacy", chain: viemChainFor(POT_CHAIN_ID) });
  });
}

/**
 * Collect `amountBase` from `from` into the pot, under the allowance `from` approved. Simulated first, so
 * a collection that would fail (approval withdrawn, money moved) costs nothing and throws in words.
 */
export function potCollectUsdc(pot: PotConfig, from: Address, amountBase: bigint): Promise<Hash> {
  return serialized(async () => {
    const client = writePublicClient(POT_CHAIN_ID);
    await client.simulateContract({ account: pot.account, address: pot.token, abi: erc20Abi, functionName: "transferFrom", args: [from, pot.address, amountBase] });
    const gasPrice = await legacyGasPrice();
    return walletFor(pot).writeContract({ address: pot.token, abi: erc20Abi, functionName: "transferFrom", args: [from, pot.address, amountBase], gasPrice, type: "legacy", chain: viemChainFor(POT_CHAIN_ID) });
  });
}

/** Send `wei` METIS from the pot (the one-time approval fee cover). */
export function potSendMetis(pot: PotConfig, to: Address, wei: bigint): Promise<Hash> {
  return serialized(async () => {
    const gasPrice = await legacyGasPrice();
    return walletFor(pot).sendTransaction({ to, value: wei, gasPrice, type: "legacy", chain: viemChainFor(POT_CHAIN_ID) });
  });
}

/** Wait for a pot transaction to be mined: "success", or "reverted". Throws when the chain does not answer. */
export async function potReceipt(hash: Hash): Promise<"success" | "reverted"> {
  const r = await writePublicClient(POT_CHAIN_ID).waitForTransactionReceipt({ hash, timeout: 90_000 });
  return r.status;
}
