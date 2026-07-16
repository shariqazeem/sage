import "server-only";

import { getAddress, type Address } from "viem";
import { GOAT_USDC } from "@/lib/deputy/networks";
import { launchChainConfig } from "@/lib/launch/deployment-service";
import { createServerWallet } from "./client";
import { createMandatePolicy } from "./mandate";
import { getAgentWallet, saveAgentWallet } from "@/lib/db/agent-wallets";

/**
 * Onboard a founder to autonomous funding, all from chat: mint a per-founder Privy server wallet
 * GUARDED AT BIRTH by their mandate policy, and bind it to their chat + SIWE-proven real address.
 * The caller must have already verified `founderAddress` via SIWE. Re-onboarding replaces the
 * binding (a fresh wallet + mandate). Returns the address the founder funds with their allowance.
 */

const GOAT = 2345;

export interface OnboardInput {
  chatId: string;
  /** the founder's real wallet, already SIWE-proven — vault guardian + sole reclaim destination. */
  founderAddress: Address;
  /** the per-campaign spend cap in USDC base units (6dp). */
  perCampaignCapBase: number;
}

export interface OnboardResult {
  privyWalletAddress: Address;
  perCampaignCapBase: number;
  reclaimAddress: Address;
}

export async function onboardFounder(input: OnboardInput): Promise<OnboardResult> {
  const cfg = launchChainConfig(GOAT);
  if (!cfg.factory) throw new Error("GOAT campaign factory not configured");
  const reclaim = getAddress(input.founderAddress);

  // 1) the mandate — a Privy policy: create via Sage's factory, approve/fund ≤ cap, sweep only home.
  const policyId = await createMandatePolicy({
    name: `mandate:${input.chatId}`,
    factory: cfg.factory,
    usdc: cfg.token ?? GOAT_USDC,
    reclaim,
    perCampaignCapBase: BigInt(input.perCampaignCapBase),
  });

  // 2) the wallet, born under that policy — it can never sign outside the mandate.
  const wallet = await createServerWallet([policyId]);

  // 3) bind chat ↔ founder ↔ wallet ↔ mandate.
  saveAgentWallet({
    chatId: input.chatId,
    founderAddress: reclaim,
    privyWalletId: wallet.id,
    privyWalletAddress: wallet.address,
    policyId,
    perCampaignCapBase: input.perCampaignCapBase,
    chainId: GOAT,
  });

  return { privyWalletAddress: wallet.address, perCampaignCapBase: input.perCampaignCapBase, reclaimAddress: reclaim };
}

export interface WalletlessInput {
  chatId: string;
  /** the per-campaign spend cap in USDC base units (6dp). */
  perCampaignCapBase: number;
}

/**
 * Onboard a founder with NO wallet of their own — the phone-first path. Their Telegram chat is the
 * account; the agent mints and holds a Privy server wallet guarded by their mandate, with the cap
 * they chose in chat. There is no external reclaim address: the mandate has no sweep rule, so
 * leftover simply STAYS in the wallet as the account's balance (withdraw is a separate action).
 * The account is its own on-chain guardian for the campaigns it funds.
 */
export async function onboardWalletless(input: WalletlessInput): Promise<OnboardResult> {
  const cfg = launchChainConfig(GOAT);
  if (!cfg.factory) throw new Error("GOAT campaign factory not configured");

  // 1) the mandate — create/approve/fund/activate within cap, NO sweep rule (leftover stays).
  const policyId = await createMandatePolicy({
    name: `mandate:${input.chatId}`,
    factory: cfg.factory,
    usdc: cfg.token ?? GOAT_USDC,
    perCampaignCapBase: BigInt(input.perCampaignCapBase),
  });

  // 2) the wallet, born under that policy.
  const wallet = await createServerWallet([policyId]);
  const self = getAddress(wallet.address);

  // 3) bind chat ↔ wallet. With no external wallet, the account IS its own address — which also
  //    serves as the on-chain guardian for the campaigns it funds.
  saveAgentWallet({
    chatId: input.chatId,
    founderAddress: self,
    privyWalletId: wallet.id,
    privyWalletAddress: wallet.address,
    policyId,
    perCampaignCapBase: input.perCampaignCapBase,
    chainId: GOAT,
  });

  return { privyWalletAddress: wallet.address, perCampaignCapBase: input.perCampaignCapBase, reclaimAddress: self };
}

/** The current binding for a chat, or null if the founder hasn't onboarded. */
export function founderBinding(chatId: string) {
  return getAgentWallet(chatId);
}
