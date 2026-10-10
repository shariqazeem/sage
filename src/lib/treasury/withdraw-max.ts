import { chainConfig } from "@/lib/deputy/networks";

/**
 * THE MOST THAT CAN LEAVE THE ACCOUNT IN ONE WITHDRAWAL.
 *
 * On a chain whose gas IS USDC (Arc), the fee comes out of the same balance before the transfer
 * runs, so a full-balance transfer can never pay for itself. Measured 10 Oct 2026 on Arc mainnet:
 * transfer(5.00) from an account holding exactly 5.00 reverted (fee 0.000635 USDC), and "all" had
 * filled in exactly that. A cent stays behind there, about fifteen times the measured fee.
 * Shared by the form (what "all" fills in) and the route (what it accepts), so they cannot drift.
 */
export const USDC_GAS_RESERVE_BASE = BigInt(10_000); // 0.01 USDC

export function gasIsUsdc(chainId: number): boolean {
  return chainConfig(chainId).nativeSymbol === "USDC";
}

/** In base units (6 dp): the balance, less the fee reserve where USDC is the gas. Never negative. */
export function maxWithdrawBase(balanceBase: bigint, chainId: number): bigint {
  const reserve = gasIsUsdc(chainId) ? USDC_GAS_RESERVE_BASE : BigInt(0);
  return balanceBase > reserve ? balanceBase - reserve : BigInt(0);
}

/** The same ceiling in whole cents, for the form: floored, never rounded up past what the account holds. */
export function maxWithdrawUsd(balanceUsd: number, chainId: number): number {
  const base = BigInt(Math.max(0, Math.floor(balanceUsd * 1_000_000 + 1e-6)));
  return Math.floor(Number(maxWithdrawBase(base, chainId)) / 10_000) / 100;
}
