import "server-only";
import { getAddress } from "viem";
import { getWebTreasury, getWebTreasuryOn } from "./web";
import { treasuryChainId } from "@/lib/privy/onboarding";
import { treasuryPreflight, type TreasuryPreflight } from "./preflight";
import { autoApprove, nativeBalanceWei, usdcBalanceBase } from "@/lib/telegram/agent-wallet-tools";
import { minLaunchGasWei, operatorCoversGas } from "./gas-policy";
import { loadApprovedPlan } from "@/lib/launch/deployment-service";
import { deriveDeploymentInputs } from "@/lib/launch/deploy-plan";
import { deployCampaignViaPrivy } from "@/lib/privy/deploy-runner";
import { gasRefusalMessage, grantGasStipend } from "./gas-stipend";
import { getInspectionJob } from "@/lib/db/inspection";
import { sameFounder } from "@/lib/auth/founder";
import { chainConfig, pausedNetworkReason } from "@/lib/deputy/networks";
import { publicClient } from "@/lib/deputy/chain";
import { metisToUsd, swapsOn } from "./swap-venue";
import { readMetisPriceUsdcBase } from "./swap";
import { launchAllowed } from "@/lib/plans/founder-plan";
import type { PlanId } from "@/lib/plans/catalog";

export type TreasuryLaunch =
  | { ok: true; campaignId: string; vault: string; steps: { step: string; txHash: string; explorerUrl: string }[] }
  | { ok: false; reason: "no_treasury" | "not_yours" | "not_ready" | "plan_limit" | "network_paused" | TreasuryPreflightReason | "failed"; message: string; upgradeTo?: PlanId | null };
type TreasuryPreflightReason = Exclude<TreasuryPreflight, { ok: true }>["reason"];

export interface TreasuryStatus {
  address: string;
  reclaimAddress: string;
  perCampaignCapUsd: number;
  balanceUsd: number;
  chainId: number;
  network: string;
  /** a testnet account holds test USDC; every door that offers it says so */
  isMainnet: boolean;
  /** the gas token's symbol; "USDC" means funding the wallet funds its gas too */
  nativeSymbol: string;
  gasNative: string | null;
  /** the gas balance in wei, as a decimal string (exact) */
  gasWei: string | null;
  /** what that gas is worth in USD, from the pool's price (Metis); null where unknown */
  gasUsd: number | null;
  enoughGas: boolean | null;
  /** the account can swap USDC ⇄ its gas token inside Sage (Metis) */
  canSwap: boolean;
  /** the network's gas price now, in wei (decimal string), so a form can price a fee; null where unread */
  gasPriceWei: string | null;
  /** the gas a launch needs on this network, in wei (decimal string) */
  launchFloorWei: string;
}

export async function webTreasuryStatus(founderAddress: string, chainId: number = treasuryChainId()): Promise<TreasuryStatus | null> {
  const t = getWebTreasuryOn(founderAddress, chainId);
  if (!t) return null;
  const c = chainConfig(t.chainId);
  const swaps = swapsOn(t.chainId);
  const [balance, gas, price, gasPrice] = await Promise.all([
    usdcBalanceBase(t.privyWalletAddress, t.chainId).catch(() => null),
    nativeBalanceWei(t.privyWalletAddress, t.chainId).catch(() => null),
    swaps ? readMetisPriceUsdcBase() : Promise.resolve(null),
    publicClient(t.chainId).getGasPrice().catch(() => null),
  ]);
  return {
    address: t.privyWalletAddress,
    reclaimAddress: t.founderAddress,
    perCampaignCapUsd: t.perCampaignCapBase / 1e6,
    balanceUsd: balance === null ? 0 : Number(balance) / 1e6,
    chainId: t.chainId,
    network: c.name,
    isMainnet: c.isMainnet,
    nativeSymbol: c.nativeSymbol,
    gasNative: gas === null ? null : (Number(gas) / 1e18).toFixed(8),
    gasWei: gas === null ? null : gas.toString(),
    gasUsd: gas === null || price === null ? null : metisToUsd(gas, price),
    enoughGas: gas === null ? null : gas >= minLaunchGasWei(t.chainId),
    canSwap: swaps,
    gasPriceWei: gasPrice === null ? null : gasPrice.toString(),
    launchFloorWei: minLaunchGasWei(t.chainId).toString(),
  };
}

/**
 * FUND ONCE, THE AGENT LAUNCHES. The founder approved the plan by asking for this (the standing
 * mandate IS the pre-authorization); the agent deploys, funds and activates the vault from the
 * treasury inside the mandate's cap. Same checks, same order, as the Telegram tool.
 */
export async function launchFromTreasury(founderAddress: string, jobId: string, chainId?: number): Promise<TreasuryLaunch> {
  const t = chainId == null ? getWebTreasury(founderAddress) : getWebTreasuryOn(founderAddress, chainId);
  if (!t) return { ok: false, reason: "no_treasury", message: `Open your account on ${chainConfig(chainId ?? treasuryChainId()).name} first — Sage launches from it.` };
  // A paused network takes no new money (networks.ts): refused before a stipend or a single call is sent.
  const paused = pausedNetworkReason(t.chainId);
  if (paused) return { ok: false, reason: "network_paused", message: paused };
  const job = getInspectionJob(jobId);
  if (!job || !sameFounder(job.founderWallet, founderAddress)) return { ok: false, reason: "not_yours", message: "That plan isn't yours." };
  if (!autoApprove(jobId, getAddress(founderAddress))) return { ok: false, reason: "not_ready", message: "This plan isn't ready to launch — it may have changed since it was planned; plan it again." };
  const loaded = loadApprovedPlan(jobId);
  if (!loaded) return { ok: false, reason: "not_ready", message: "Couldn't load the approved plan." };
  const budget = deriveDeploymentInputs(loaded.plan).totalBudgetBase;
  // The plan's limits, before a cent moves (never after: a live job keeps paying its workers).
  const allowed = launchAllowed(founderAddress, budget);
  if (!allowed.ok) return { ok: false, reason: "plan_limit", message: allowed.message, upgradeTo: allowed.upgradeTo };
  const [balance, gas, gasPriceWei] = await Promise.all([
    usdcBalanceBase(t.privyWalletAddress, t.chainId),
    nativeBalanceWei(t.privyWalletAddress, t.chainId),
    publicClient(t.chainId).getGasPrice().catch(() => undefined),
  ]);
  const preflight = (gasWei: bigint) => treasuryPreflight({ budgetBase: budget, capBase: BigInt(t.perCampaignCapBase), balanceBase: balance, gasWei, minGasWei: minLaunchGasWei(t.chainId), address: t.privyWalletAddress, chainId: t.chainId, gasPriceWei });
  let pf = preflight(gas);
  // The account pays its own network fee (gas-policy.ts operatorCoversGas): the preflight's own words
  // say how much and how to get it. Only a deployment that turned the old cover back on sends any.
  if (!pf.ok && pf.reason === "needsGas" && operatorCoversGas()) {
    const stipend = await grantGasStipend({ chainId: t.chainId, wallet: t.privyWalletAddress, walletUsdcBase: balance, budgetBase: budget, gasWei: gas, minGasWei: minLaunchGasWei(t.chainId) });
    if (stipend.granted) pf = preflight(await nativeBalanceWei(t.privyWalletAddress, t.chainId));
    else pf = { ok: false, reason: "needsGas", message: gasRefusalMessage(stipend.reason, t.privyWalletAddress, t.chainId) };
  }
  if (!pf.ok) return { ok: false, reason: pf.reason, message: pf.message };
  try {
    const r = await deployCampaignViaPrivy(t.chatId, jobId);
    return { ok: true, campaignId: r.campaignId, vault: r.vault, steps: r.steps };
  } catch (e) {
    return { ok: false, reason: "failed", message: e instanceof Error ? e.message.slice(0, 200) : "launch failed" };
  }
}
