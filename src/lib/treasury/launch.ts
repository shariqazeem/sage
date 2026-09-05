import "server-only";
import { getAddress } from "viem";
import { getWebTreasury, webTreasuryKey } from "./web";
import { treasuryPreflight, type TreasuryPreflight } from "./preflight";
import { autoApprove, MIN_GAS_WEI, nativeBalanceWei, usdcBalanceBase } from "@/lib/telegram/agent-wallet-tools";
import { loadApprovedPlan } from "@/lib/launch/deployment-service";
import { deriveDeploymentInputs } from "@/lib/launch/deploy-plan";
import { deployCampaignViaPrivy } from "@/lib/privy/deploy-runner";
import { gasRefusalMessage, grantGasStipend } from "./gas-stipend";
import { getInspectionJob } from "@/lib/db/inspection";
import { sameFounder } from "@/lib/auth/founder";

export type TreasuryLaunch =
  | { ok: true; campaignId: string; vault: string; steps: { step: string; txHash: string; explorerUrl: string }[] }
  | { ok: false; reason: "no_treasury" | "not_yours" | "not_ready" | TreasuryPreflightReason | "failed"; message: string };
type TreasuryPreflightReason = Exclude<TreasuryPreflight, { ok: true }>["reason"];

export interface TreasuryStatus {
  address: string;
  reclaimAddress: string;
  perCampaignCapUsd: number;
  balanceUsd: number;
  gasBtc: string | null;
  enoughGas: boolean | null;
}

export async function webTreasuryStatus(founderAddress: string): Promise<TreasuryStatus | null> {
  const t = getWebTreasury(founderAddress);
  if (!t) return null;
  const [balance, gas] = await Promise.all([usdcBalanceBase(t.privyWalletAddress).catch(() => null), nativeBalanceWei(t.privyWalletAddress).catch(() => null)]);
  return {
    address: t.privyWalletAddress,
    reclaimAddress: t.founderAddress,
    perCampaignCapUsd: t.perCampaignCapBase / 1e6,
    balanceUsd: balance === null ? 0 : Number(balance) / 1e6,
    gasBtc: gas === null ? null : (Number(gas) / 1e18).toFixed(8),
    enoughGas: gas === null ? null : gas >= MIN_GAS_WEI,
  };
}

/**
 * FUND ONCE, THE AGENT LAUNCHES. The founder approved the plan by asking for this (the standing
 * mandate IS the pre-authorization); the agent deploys, funds and activates the vault from the
 * treasury inside the mandate's cap. Same checks, same order, as the Telegram tool.
 */
export async function launchFromTreasury(founderAddress: string, jobId: string): Promise<TreasuryLaunch> {
  const t = getWebTreasury(founderAddress);
  if (!t) return { ok: false, reason: "no_treasury", message: "Create a treasury in Settings first — the agent launches from it." };
  const job = getInspectionJob(jobId);
  if (!job || !sameFounder(job.founderWallet, founderAddress)) return { ok: false, reason: "not_yours", message: "That plan isn't yours." };
  if (!autoApprove(jobId, getAddress(founderAddress))) return { ok: false, reason: "not_ready", message: "This plan isn't ready to launch — it may have changed since it was planned; plan it again." };
  const loaded = loadApprovedPlan(jobId);
  if (!loaded) return { ok: false, reason: "not_ready", message: "Couldn't load the approved plan." };
  const budget = deriveDeploymentInputs(loaded.plan).totalBudgetBase;
  const [balance, gas] = await Promise.all([usdcBalanceBase(t.privyWalletAddress), nativeBalanceWei(t.privyWalletAddress)]);
  const preflight = (gasWei: bigint) => treasuryPreflight({ budgetBase: budget, capBase: BigInt(t.perCampaignCapBase), balanceBase: balance, gasWei, minGasWei: MIN_GAS_WEI, address: t.privyWalletAddress });
  let pf = preflight(gas);
  if (!pf.ok && pf.reason === "needsGas") {
    // The USDC is there and only gas is missing: the operator covers the launch floor, once.
    const stipend = await grantGasStipend({ wallet: t.privyWalletAddress, walletUsdcBase: balance, budgetBase: budget, gasWei: gas, minGasWei: MIN_GAS_WEI });
    if (stipend.granted) pf = preflight(await nativeBalanceWei(t.privyWalletAddress));
    else pf = { ok: false, reason: "needsGas", message: gasRefusalMessage(stipend.reason, t.privyWalletAddress) };
  }
  if (!pf.ok) return { ok: false, reason: pf.reason, message: pf.message };
  try {
    const r = await deployCampaignViaPrivy(webTreasuryKey(founderAddress), jobId);
    return { ok: true, campaignId: r.campaignId, vault: r.vault, steps: r.steps };
  } catch (e) {
    return { ok: false, reason: "failed", message: e instanceof Error ? e.message.slice(0, 200) : "launch failed" };
  }
}
