import "server-only";
import { founderChain } from "@/lib/auth/founder";
import { getWebTreasury } from "./web";
import { treasuryChainId } from "@/lib/privy/onboarding";
import { privyConfigured } from "@/lib/privy/client";
import { usdcBalanceBase } from "@/lib/telegram/agent-wallet-tools";
import { chainConfig } from "@/lib/deputy/networks";

/**
 * THE ACCOUNT IN ONE SENTENCE, for every surface that mentions it before showing it — the agent's
 * next move on Home and on the autopilot page, the mandate's stance, the deploy door.
 *
 * Three states, and the page must say which: the founder HAS an account (a balance to show), CAN
 * open one (a door), or CANNOT — and the reason. A Starknet sign-in has no Ethereum address for the
 * mandate to reclaim to, so the account — a Privy-held EVM wallet — is not available to it; the
 * founder is told so in those words rather than sent to a button that fails. Measured 2026-09-10 on
 * the founder's own Starknet session: "$0.00 in the treasury", "Fund it and Sage moves", and at the
 * end of that path a card saying treasuries bind to an Ethereum account.
 */
export type AccountUnavailable = "starknet" | "unconfigured";

export interface AccountSummary {
  /** an account can exist for this founder on this deployment */
  available: boolean;
  /** why not, when not */
  reason: AccountUnavailable | null;
  /** the account on the default chain exists */
  exists: boolean;
  address: string | null;
  balanceBase: number;
  chainId: number;
  network: string;
  isMainnet: boolean;
}

export function accountUnavailableBecause(founder: string): AccountUnavailable | null {
  if (founderChain(founder) !== "evm") return "starknet";
  if (!privyConfigured()) return "unconfigured";
  return null;
}

export async function accountSummary(founder: string, known: { balanceBase?: number } = {}): Promise<AccountSummary> {
  const reason = accountUnavailableBecause(founder);
  const t = reason ? null : getWebTreasury(founder);
  const chainId = t?.chainId ?? treasuryChainId();
  const c = chainConfig(chainId);
  let balanceBase = known.balanceBase ?? 0;
  if (t && known.balanceBase === undefined) {
    try {
      balanceBase = Number(await usdcBalanceBase(t.privyWalletAddress, t.chainId));
    } catch {
      balanceBase = 0;
    }
  }
  return { available: reason === null, reason, exists: t !== null, address: t?.privyWalletAddress ?? null, balanceBase, chainId, network: c.name, isMainnet: c.isMainnet };
}
