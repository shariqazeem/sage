import "server-only";

import { getAddress, type Address } from "viem";
import type { AgentWallet } from "@/lib/db/schema";
import { acquireLock, releaseLock } from "@/lib/db/campaigns";
import { setWalletPolicies } from "./client";
import type { MandateSpec } from "./mandate";
import { mandateName } from "./mandate-name";

/**
 * ONE PERMIT AT A TIME PER ACCOUNT.
 *
 * A Privy wallet enforces exactly one policy. Every move the base mandate does not allow by itself (a
 * withdrawal, a swap, sending METIS, stopping a job) mints a SCOPED policy for that one move, swaps
 * the wallet onto it, signs, and re-locks the wallet to its mandate. Two of those at once on one
 * wallet would overwrite each other: the second permit replaces the first mid-flight, and the
 * first's re-lock strips the second's permit before it signs. Each move takes this wallet's lock
 * first, and a second one is told, in words, to wait a moment.
 */
export class AccountBusyError extends Error {
  constructor() {
    super("Another move from this account is going through. Try again in a moment.");
    this.name = "AccountBusyError";
  }
}

export async function restoreBasePolicy(walletId: string, basePolicyId: string): Promise<void> {
  for (let i = 0; i < 3; i++) {
    try {
      await setWalletPolicies(walletId, [basePolicyId]);
      return;
    } catch (e) {
      console.error(`[permit] re-lock attempt ${i + 1}/3 failed for ${walletId}:`, e);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  // Every scoped policy pins its recipient and amount, so a failed re-lock is low-risk, but it is
  // surfaced loudly so it can be re-locked out of band.
  console.error(`[permit] CRITICAL: could not re-lock wallet ${walletId} to base policy ${basePolicyId}`);
}

/**
 * Run `move` with the wallet on a scoped policy, then ALWAYS re-lock it to the base mandate. The
 * lock outlives a slow chain (five minutes) and is released whatever happened.
 */
export async function withScopedPolicy<T>(wallet: AgentWallet, createPolicy: () => Promise<string>, move: () => Promise<T>): Promise<T> {
  return withWalletLock(wallet, async () => {
    const policyId = await createPolicy();
    await setWalletPolicies(wallet.privyWalletId, [policyId]);
    try {
      return await move();
    } finally {
      await restoreBasePolicy(wallet.privyWalletId, wallet.policyId);
    }
  });
}

/**
 * Hold this wallet's permit lock for the length of `fn`. Changing the account's cap repoints the
 * wallet at a NEW base mandate, so it takes the same lock: a cap change landing mid-swap would
 * otherwise be undone by the swap's re-lock, which restores the policy it started from.
 */
export async function withWalletLock<T>(wallet: Pick<AgentWallet, "privyWalletId">, fn: () => Promise<T>): Promise<T> {
  const lock = `wallet-permit:${wallet.privyWalletId}`;
  if (!acquireLock(lock, 300)) throw new AccountBusyError();
  try {
    return await fn();
  } finally {
    releaseLock(lock);
  }
}

/**
 * The account's base mandate, rebuilt for a scoped policy to extend: the same factory, token, cap
 * and (for an account with a separate owner wallet) reclaim address it was born with, so a launch
 * that runs while a scoped permit is attached is allowed exactly as it would be under the mandate.
 */
export function accountBaseSpec(wallet: AgentWallet, cfg: { factory: Address | null; token: Address | null }): MandateSpec {
  if (!cfg.factory || !cfg.token) throw new Error(`the account's network (${wallet.chainId}) has no vault factory configured`);
  const self = getAddress(wallet.privyWalletAddress);
  const owner = getAddress(wallet.founderAddress);
  return {
    name: mandateName(wallet.chatId),
    factory: getAddress(cfg.factory),
    usdc: getAddress(cfg.token),
    ...(owner !== self ? { reclaim: owner } : {}),
    perCampaignCapBase: BigInt(wallet.perCampaignCapBase),
  };
}
