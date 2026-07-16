import "server-only";

import { getAddress, type Address, type Hex } from "viem";
import { buildDeployBundle } from "@/lib/launch/deploy-plan";
import {
  buildSettings,
  defaultDailyCap,
  loadApprovedPlan,
  DEFAULT_DURATION_SECONDS,
} from "@/lib/launch/deployment-service";
import { getInspectionJob } from "@/lib/db/inspection";
import { attachV2Campaign, type V2MissionSetupInput } from "@/lib/campaigns/v2-setup";
import { getAgentWallet } from "@/lib/db/agent-wallets";
import { executeSequenceViaPrivy } from "./executor";

/**
 * Deploy a whole campaign ENTIRELY from the agent's chat turn, then record it — the founder never
 * signs in a browser. It builds the EXACT same create → approve → fund → activate bundle the web
 * app uses (`deploy-plan.ts`, unchanged), with `owner = the founder's Privy wallet`, signs +
 * broadcasts each step through Privy inside the mandate, then re-verifies the vault against the
 * plan and atomically attaches the campaign (`attachV2Campaign`, the same path the web app uses —
 * which independently checks the on-chain vault matches the approved plan before persisting).
 *
 * The result is a founder-address-owned, funded, Deputy-operated campaign — on-chain and in the DB
 * identical to a web-app deploy, and now on autopilot so the Deputy pays verified testers itself.
 */

export interface DeployRunResult {
  vault: Address;
  ownerWallet: Address;
  campaignId: string;
  steps: Array<{ step: string; txHash: Hex; explorerUrl: string }>;
}

function campaignTitle(productUrl: string): string {
  try {
    return `Testing campaign · ${new URL(productUrl).host}`;
  } catch {
    return "Sage testing campaign";
  }
}

export async function deployCampaignViaPrivy(chatId: string, jobId: string): Promise<DeployRunResult> {
  const wallet = getAgentWallet(chatId);
  if (!wallet) throw new Error("no agent wallet is bound to this chat — onboard first");

  const loaded = loadApprovedPlan(jobId);
  if (!loaded) throw new Error("this inspection has no approved plan to deploy");

  const owner = getAddress(wallet.privyWalletAddress);
  const settingsRes = buildSettings(
    loaded.plan,
    {
      owner, // the Privy wallet OWNS the vault (msg.sender), like the founder's browser wallet does
      guardian: getAddress(wallet.founderAddress), // the founder's real (SIWE) wallet is the guardian
      dailyVelocityCapBase: defaultDailyCap(loaded.plan),
      durationSeconds: DEFAULT_DURATION_SECONDS,
    },
    wallet.chainId,
  );
  if (!settingsRes.ok) throw new Error(`deploy settings invalid: ${settingsRes.errors.join(", ")}`);
  const settings = settingsRes.settings;

  const bundle = buildDeployBundle(loaded.plan, settings);
  const results = await executeSequenceViaPrivy(
    wallet.privyWalletId,
    owner,
    bundle.calls.map((c) => ({ to: c.to, data: c.data, label: c.step })),
    wallet.chainId,
  );

  // Record the campaign — the SAME atomic attach the web app uses, which re-reads the on-chain
  // vault and fails closed unless it matches the approved plan. Deps `{}` = the real adapter.
  const job = getInspectionJob(jobId);
  const missions: V2MissionSetupInput[] = loaded.plan.missions.map((m) => ({
    missionKey: m.missionKey,
    title: m.title,
    objective: m.objective,
    instructions: m.instructions,
    targetSurface: m.targetSurface,
    criteria: m.criteria,
    evidenceRequirements: m.evidenceRequirements,
    rewardBase: BigInt(m.rewardBase),
    maxCompletions: BigInt(m.maxCompletions),
  }));
  const attach = await attachV2Campaign(
    {
      publicCampaignId: loaded.plan.publicCampaignId,
      title: campaignTitle(job?.productUrl ?? ""),
      productUrl: job?.productUrl ?? "",
      chainId: settings.chainId,
      expectedToken: getAddress(settings.token),
      founderAddress: owner,
      operatorAddress: getAddress(settings.operator),
      guardian: getAddress(settings.guardian),
      factoryAddress: getAddress(settings.factory),
      vaultAddress: bundle.predictedVault,
      missions,
      autonomy: "autopilot",
    },
    {},
  );
  if (!attach.ok) {
    throw new Error(`the vault deployed + funded, but recording it failed (${attach.stage}): ${attach.errors.join(", ")}`);
  }

  return {
    vault: bundle.predictedVault,
    ownerWallet: owner,
    campaignId: attach.campaignId,
    steps: bundle.calls.map((c, i) => ({ step: c.step, txHash: results[i].txHash, explorerUrl: results[i].explorerUrl })),
  };
}
