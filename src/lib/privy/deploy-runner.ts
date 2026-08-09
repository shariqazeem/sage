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
import { attachApprovedPolicyToCampaign } from "@/lib/campaigns/attach-policy";
import { getAgentWallet } from "@/lib/db/agent-wallets";
import { executeSequenceViaPrivy } from "./executor";
import { campaignFeeBase, isSelfFunded } from "@/lib/x402/campaign-fee";
import { campaignFeeEnabled, operatorChatId, operatorWallets } from "@/lib/x402/fee-config";
import { openCampaignFeeOrder } from "@/lib/x402/payer";
import {
  getCampaignFee,
  markCampaignFeeSettled,
  recordCampaignFee,
  recordCampaignFeeFailure,
} from "@/lib/db/campaign-fees";

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

  /**
   * THE LAUNCH FEE — opened here, paid by the founder as the bundle's last call.
   *
   * Opening an x402 order (rather than transferring straight to our address) is what puts the
   * payment in the GOAT Flow merchant dashboard with an amount and a payer. `openCampaignFeeOrder`
   * returns null whenever the rail is unconfigured or unreachable, and that path is deliberately
   * silent: our billing being down must never cost a founder their launch, so the bundle simply
   * builds without a fee call, exactly as it did before this existed.
   */
  // Defensive conversion: an absent or unparseable budget means NO fee, never a thrown launch. The
  // deploy is the founder's, and a billing detail must not be able to take it down.
  const budgetBase = (() => {
    try {
      return BigInt(loaded.plan.totalBudgetBase ?? 0);
    } catch {
      return BigInt(0);
    }
  })();
  const feeBase = campaignFeeBase(budgetBase);
  const selfFunded =
    isSelfFunded(owner, operatorWallets()) ||
    isSelfFunded(wallet.founderAddress, operatorWallets()) ||
    // a walletless founder's Privy wallet is minted per chat and matches no allowlist, so the
    // operator launching from their own bot is only recognisable by the chat id
    (operatorChatId() !== null && String(chatId) === operatorChatId());

  // Armed explicitly, never implicitly: x402 is already live in production, so without this gate
  // shipping the code and charging the first founder would be the same act.
  const feeOrder = campaignFeeEnabled() && feeBase > BigInt(0)
    ? await openCampaignFeeOrder({
        // unique per campaign: a reused dappOrderId is rejected with "order already exists" once its
        // first order expires, which stranded nine operator fees for a month
        dappOrderId: `launch-${loaded.plan.publicCampaignId}`,
        amountBase: feeBase,
        fromAddress: owner,
      })
    : null;

  if (feeOrder) {
    recordCampaignFee({
      campaignId: loaded.plan.publicCampaignId,
      inspectionId: jobId,
      budgetBase: Number(budgetBase),
      amountBase: Number(feeBase),
      payerAddress: owner,
      selfFunded,
    });
  }

  const bundle = buildDeployBundle(loaded.plan, {
    ...settings,
    ...(feeOrder ? { feeTo: feeOrder.payToAddress } : {}),
  });
  /**
   * THE FEE IS EXECUTED SEPARATELY, AND IT CAN NEVER FAIL THE LAUNCH.
   *
   * Every wallet onboarded before this existed carries a mandate with no fee rule, and Privy's
   * enclave refuses any signature outside the policy. Inside one sequence that refusal throws after
   * create/approve/fund/activate have already succeeded, so the vault would be live and funded while
   * `attachV2Campaign` never runs — a real on-chain campaign with no database row, invisible to the
   * founder and to the sweep. That is far worse than an uncollected fee.
   *
   * So the four core calls run as before, and the fee runs after, guarded. An old mandate simply
   * leaves the fee pending with the refusal recorded on the row, which the operator can see and
   * re-charge once the wallet is re-policied.
   */
  const coreCalls = bundle.calls.filter((c) => c.step !== "fee");
  const feeCall = bundle.calls.find((c) => c.step === "fee");
  const results = await executeSequenceViaPrivy(
    wallet.privyWalletId,
    owner,
    coreCalls.map((c) => ({ to: c.to, data: c.data, label: c.step })),
    wallet.chainId,
  );

  if (feeCall && feeOrder) {
    const row = getCampaignFee(loaded.plan.publicCampaignId);
    try {
      const [feeRes] = await executeSequenceViaPrivy(
        wallet.privyWalletId,
        owner,
        [{ to: feeCall.to, data: feeCall.data, label: feeCall.step }],
        wallet.chainId,
      );
      // The receipt is in hand, so the USDC is at the merchant. Record it here rather than after the
      // campaign attach, which can throw — that would lose the tx of money already spent and a retry
      // would charge the founder twice. The same rule the operator-fee repair was built on.
      if (row && feeRes?.txHash) markCampaignFeeSettled(row.id, feeRes.txHash, feeOrder.orderId);
    } catch (err) {
      if (row) recordCampaignFeeFailure(row.id, err instanceof Error ? err.message : String(err));
    }
  }

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

  // PARITY with the web deploy (attach/route.ts:159) — the approved revision's VerificationPolicyV2 MUST bind to
  // the new campaign, fail-closed, so a covenant-required (canary/action-replay) plan launched walletlessly gets
  // the SAME frozen/reproduced-permit covenant the SIWE web path enforces. A non-required (legacy) revision is a
  // legitimate no-op. Without this, the campaign row keeps verificationPolicyRequired=false and settlement would
  // silently pay under legacy rules — the exact Telegram↔web divergence this closes.
  const policyAttach = attachApprovedPolicyToCampaign(attach.campaignId, jobId);
  if (!policyAttach.ok) {
    throw new Error(`the vault deployed + funded, but the verification covenant could not attach (${policyAttach.reason}) — retry recording`);
  }

  return {
    vault: bundle.predictedVault,
    ownerWallet: owner,
    campaignId: attach.campaignId,
    // the CORE calls only — the fee runs separately and its outcome lives on the campaign_fees row
    steps: coreCalls.map((c, i) => ({ step: c.step, txHash: results[i].txHash, explorerUrl: results[i].explorerUrl })),
  };
}
