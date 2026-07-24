import "server-only";

import { erc20Abi, getAddress, type Address } from "viem";

import type { McpToolDef, ToolResult } from "@/lib/mcp/server";
import { founderBinding, onboardWalletless } from "@/lib/privy/onboarding";
import { deployCampaignViaPrivy } from "@/lib/privy/deploy-runner";
import { withdrawViaPrivy } from "@/lib/privy/withdraw";
import { stopCampaignViaPrivy } from "@/lib/privy/stop-campaign";
import { getInspectionJob } from "@/lib/db/inspection";
import { putPendingWithdrawal, consumePendingWithdrawal } from "@/lib/db/pending-withdrawals";
import { getCurrentRevision, approveRevision } from "@/lib/db/plan-revisions";
import { verifyPlanForApproval } from "@/lib/launch/approve";
import { checkRevisionPolicyForApproval } from "@/lib/launch/approve-policy";
import { deserializePlan } from "@/lib/launch/serde";
import { MISSION_PROMPT_VERSION } from "@/lib/launch/mission-prompt";
import { loadApprovedPlan } from "@/lib/launch/deployment-service";
import { deriveDeploymentInputs } from "@/lib/launch/deploy-plan";
import { publicClient } from "@/lib/deputy/chain";
import { GOAT_USDC } from "@/lib/deputy/networks";
import { getCampaign, getSubmission, setCampaignStatus } from "@/lib/db/campaigns";
import {
  listHeldSubmissions,
  releaseSubmission,
  rejectSubmission,
  reviewSummary,
  ownsCampaign,
} from "@/lib/campaigns/review-actions";
import { autonomousResolutionStats } from "@/lib/campaigns/held-triage";
import { putPendingReview, consumePendingReview } from "./pending-review";

/**
 * The Telegram concierge's AGENT-WALLET tools — the only place the chat agent can move money, and
 * it moves ONLY the founder's own allowance into the founder's own campaigns, inside the Privy
 * mandate. These are deliberately NOT in the public MCP registry (that stays read/inspect-only for
 * external agents); they exist only for @sagedeputybot, keyed on the founder's chat.
 */

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://sagepays.xyz").replace(/\/$/, "");
}
const usd = (base: bigint): number => Number(base) / 1_000_000;
const ok = (obj: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(obj) }], isError: false });
const err = (message: string): ToolResult => ({ content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }], isError: true });

async function usdcBalanceBase(address: string): Promise<bigint> {
  return publicClient(2345).readContract({
    address: GOAT_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [getAddress(address)],
  }) as Promise<bigint>;
}

// A withdrawal the founder requested but hasn't yet confirmed is kept server-side (not in the
// model's hands) so the confirmed transfer is EXACTLY what was prepared — the agent can't alter the
// amount or recipient. It is stored DURABLY (pending_withdrawals table) so a pm2 restart between
// request and confirm no longer drops it; consume is atomic + one-shot (see db/pending-withdrawals).

/** Auto-approve the current plan revision (the standing mandate IS the founder's pre-authorization). */
function autoApprove(jobId: string, approver: string): boolean {
  const job = getInspectionJob(jobId);
  if (!job || job.status !== "ready") return false;
  const current = getCurrentRevision(jobId);
  if (!current) return false;
  const verified = verifyPlanForApproval(deserializePlan(current.planJson), {
    approver,
    model: current.model,
    provider: current.provider,
    promptVersion: MISSION_PROMPT_VERSION,
  });
  if (!verified.ok) return false;
  // PARITY with the web SIWE approve route (approve/route.ts:60-73) — validate + bind the revision's
  // VerificationPolicyV2 at approval. A required-but-missing / malformed / stale / mismatched / incomplete policy
  // fails CLOSED (no approval), and the bound digest is written into the immutable approval record. A non-required
  // (legacy) revision binds nothing. Without this, a walletless approval skipped the covenant the web door binds.
  const policyCheck = checkRevisionPolicyForApproval({
    verificationPolicy: current.verificationPolicy ?? null,
    verificationPolicyDigest: current.verificationPolicyDigest ?? null,
    verificationPolicyRequired: current.verificationPolicyRequired === true,
    planMissionPlanDigest: deserializePlan(current.planJson).missionPlanDigest,
  });
  if (!policyCheck.ok) return false;
  const approvalRecord: unknown = policyCheck.boundDigest
    ? { ...(verified.approvalRecord as Record<string, unknown>), verificationPolicyDigest: policyCheck.boundDigest, verificationPolicyVersion: policyCheck.version, verificationPolicyRequired: current.verificationPolicyRequired === true }
    : verified.approvalRecord;
  return approveRevision(jobId, current.revisionNumber, approver, approvalRecord).ok;
}

export const AGENT_WALLET_TOOLS: McpToolDef[] = [
  {
    name: "sage_setup_wallet",
    description:
      "Create the founder's agent wallet right here in chat — no browser, no MetaMask — with a per-campaign spending cap they choose. Call this when a founder wants YOU to fund + launch campaigns for them and sage_agent_wallet_status shows they're not set up yet. Ask them for a per-campaign cap in whole USDC first. Returns the wallet address for them to fund with USDC.",
    inputSchema: {
      type: "object",
      properties: {
        perCampaignCapUsd: { type: "number", description: "Per-campaign spend cap in whole USDC (1–100000), chosen by the founder." },
      },
      required: ["perCampaignCapUsd"],
    },
  },
  {
    name: "sage_agent_wallet_status",
    description:
      "Check whether this founder has linked an agent wallet, its address, its USDC balance, and their per-campaign spending cap. Use before trying to fund + launch. Read-only.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "sage_fund_and_launch",
    description:
      "Fund + launch a campaign from an APPROVED-READY inspection using the founder's own agent wallet, within their mandate — no browser, no signature. Only call after sage_start_inspection + sage_get_inspection show the plan is ready AND sage_agent_wallet_status shows a funded wallet. It creates + funds the vault and puts it live on autopilot. Returns the live campaign + links.",
    inputSchema: {
      type: "object",
      properties: { inspectionId: { type: "string", description: "The ready inspection to launch." } },
      required: ["inspectionId"],
    },
  },
  {
    name: "sage_request_withdrawal",
    description:
      "Prepare a withdrawal of USDC from the founder's agent wallet to an address they give. This does NOT move any funds — it validates the amount + address and asks you to confirm with the founder. After they clearly say yes, call sage_confirm_withdrawal. (Leftover otherwise just stays as their balance.)",
    inputSchema: {
      type: "object",
      properties: {
        amountUsd: { type: "number", description: "How much USDC to withdraw (whole USDC)." },
        toAddress: { type: "string", description: "The 0x… address to send the USDC to." },
      },
      required: ["amountUsd", "toAddress"],
    },
  },
  {
    name: "sage_confirm_withdrawal",
    description:
      "Execute the withdrawal the founder just confirmed (prepared by sage_request_withdrawal). Only call AFTER they clearly say yes to the exact amount + address. This moves real funds. Returns the transaction + explorer link.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "sage_list_held",
    description:
      "List the submissions Sage HELD for review on one of the founder's campaigns (it wasn't confident enough to auto-pay). Use when the founder asks to see or review held work. Returns each held submission's id, mission, confidence, a reason class, and the public evidence link — never the tester's private note. Gated to the founder's own campaigns.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "The campaign to list held submissions for." },
      },
      required: ["campaignId"],
    },
  },
  {
    name: "sage_release_submission",
    description:
      "Prepare to RELEASE (approve + pay) one held submission the founder wants to accept. This does NOT pay yet — it returns a summary to read back to the founder. After they clearly say yes, call sage_confirm_release. Never releases on its own. Gated to the founder's own campaigns.",
    inputSchema: {
      type: "object",
      properties: {
        submissionId: { type: "string", description: "The held submission id (from sage_list_held)." },
      },
      required: ["submissionId"],
    },
  },
  {
    name: "sage_confirm_release",
    description:
      "Actually release the prepared submission — settles the real payout through the vault (which enforces the cap + reward; no amount is passed). Call ONLY after the founder clearly confirms the summary from sage_release_submission.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "sage_reject_submission",
    description:
      "Reject one held submission the founder does NOT want to pay — marks it rejected, no payout, no funds move. Gated to the founder's own campaigns.",
    inputSchema: {
      type: "object",
      properties: {
        submissionId: { type: "string", description: "The held submission id." },
        why: { type: "string", description: "Optional short reason (kept internal, not shown to the tester)." },
      },
      required: ["submissionId"],
    },
  },
  {
    name: "sage_stop_campaign",
    description:
      "Permanently STOP one of the founder's campaigns and return its remaining USDC to their Sage agent wallet. Use when the founder wants to cancel a campaign, stop testing, wind down a campaign that found no testers, or recover leftover funds after creating a campaign. It revokes the vault on-chain then withdraws the remainder back to their own wallet. Call ONLY after the founder clearly confirms they want to permanently stop THAT specific campaign — it cannot be undone and any not-yet-approved submissions won't be paid. Afterwards the recovered USDC sits in their agent wallet; they can send it out with sage_request_withdrawal. Only works for campaigns launched from this chat (the agent wallet must own the vault).",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "The campaign id to stop (from sage_fund_and_launch or sage_get_campaign)." },
      },
      required: ["campaignId"],
    },
  },
];

const NAMES = new Set(AGENT_WALLET_TOOLS.map((t) => t.name));
export function isAgentWalletTool(name: string): boolean {
  return NAMES.has(name);
}

/** Dispatch an agent-wallet tool for a specific founder chat. Never throws. */
export async function callAgentWalletTool(
  name: string,
  args: Record<string, unknown>,
  chatId: string,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "sage_setup_wallet": {
        const existing = founderBinding(chatId);
        if (existing) {
          const balance = await usdcBalanceBase(existing.privyWalletAddress);
          return ok({
            ok: true,
            alreadySetUp: true,
            walletAddress: existing.privyWalletAddress,
            balanceUsdc: usd(balance),
            perCampaignCapUsdc: usd(BigInt(existing.perCampaignCapBase)),
            message: `This founder already has an agent wallet. To add funds, tell them to send two things — USDC (their testing budget) and a little BTC for gas (BTC is GOAT's native gas token). Put the address on its OWN LINE so it's easy to tap-copy:\n${existing.privyWalletAddress}`,
          });
        }
        const capUsd = typeof args.perCampaignCapUsd === "number" ? args.perCampaignCapUsd : 0;
        if (!(capUsd > 0) || capUsd > 100_000) {
          return err("Ask the founder for a per-campaign cap between 1 and 100000 USDC, then call again with perCampaignCapUsd.");
        }
        const result = await onboardWalletless({ chatId, perCampaignCapBase: Math.round(capUsd * 1_000_000) });
        return ok({
          ok: true,
          walletAddress: result.privyWalletAddress,
          perCampaignCapUsdc: capUsd,
          message: `Agent wallet created on GOAT (you can spend up to ${capUsd} USDC per campaign; any leftover stays as their balance). Relay this to the founder: send two things to the address below — USDC (their testing budget) and a little BTC for gas (BTC is GOAT's native gas token). Put the address on its OWN LINE so it's easy to tap-copy:\n${result.privyWalletAddress}`,
        });
      }
      case "sage_agent_wallet_status": {
        const b = founderBinding(chatId);
        if (!b) return ok({ ok: true, linked: false, message: "No agent wallet yet — call sage_setup_wallet." });
        const balance = await usdcBalanceBase(b.privyWalletAddress);
        return ok({
          ok: true,
          linked: true,
          walletAddress: b.privyWalletAddress,
          balanceUsdc: usd(balance),
          perCampaignCapUsdc: usd(BigInt(b.perCampaignCapBase)),
          reclaimAddress: b.founderAddress,
        });
      }
      case "sage_fund_and_launch": {
        const b = founderBinding(chatId);
        if (!b) return err("The founder hasn't set up an agent wallet yet — call sage_setup_wallet.");
        const inspectionId = typeof args.inspectionId === "string" ? args.inspectionId : "";
        if (!inspectionId) return err("inspectionId is required.");
        if (!autoApprove(inspectionId, b.founderAddress)) {
          return err("That inspection has no ready plan to launch — start an inspection and wait until it's ready.");
        }
        const loaded = loadApprovedPlan(inspectionId);
        if (!loaded) return err("Couldn't load the approved plan.");
        const budget = deriveDeploymentInputs(loaded.plan).totalBudgetBase;
        if (budget > BigInt(b.perCampaignCapBase)) {
          return ok({
            ok: false,
            overCap: true,
            budgetUsdc: usd(budget),
            perCampaignCapUsdc: usd(BigInt(b.perCampaignCapBase)),
            message: "This campaign's budget exceeds the founder's per-campaign cap — lower the budget or have them raise the cap.",
          });
        }
        const balance = await usdcBalanceBase(b.privyWalletAddress);
        if (balance < budget) {
          return ok({
            ok: false,
            needsFunding: true,
            budgetUsdc: usd(budget),
            balanceUsdc: usd(balance),
            walletAddress: b.privyWalletAddress,
            message: `The agent wallet needs ${usd(budget)} USDC but holds ${usd(balance)}. Ask the founder to send USDC (plus a little native BTC for gas) to ${b.privyWalletAddress}.`,
          });
        }
        // GOAT gas is native (BTC). The wallet signs + broadcasts 4 txs itself, so it needs enough
        // native balance for the whole sequence — catch a zero/too-low balance here so we never do a
        // partial deploy (vault created, then out of gas before it's funded).
        const gas = await publicClient(2345).getBalance({ address: getAddress(b.privyWalletAddress) });
        const minGasWei = BigInt(3_000_000_000_000); // ~0.000003 BTC — covers the 4-tx deploy with headroom
        if (gas < minGasWei) {
          return ok({
            ok: false,
            needsGas: true,
            walletAddress: b.privyWalletAddress,
            message: `The agent wallet needs a little native BTC for gas (BTC is GOAT's gas token). Ask the founder to send about 0.00001 BTC to ${b.privyWalletAddress}, then try again.`,
          });
        }
        const result = await deployCampaignViaPrivy(chatId, inspectionId);
        return ok({
          ok: true,
          campaignId: result.campaignId,
          vault: result.vault,
          campaignUrl: `${appUrl()}/c/${result.campaignId}`,
          launchTxs: result.steps.map((s) => ({ step: s.step, explorerUrl: s.explorerUrl })),
          message: "Campaign is live on autopilot — the Deputy will pay verified testers from this vault.",
        });
      }
      case "sage_request_withdrawal": {
        const b = founderBinding(chatId);
        if (!b) return err("There's no agent wallet yet, so there's nothing to withdraw.");
        const amountUsd = typeof args.amountUsd === "number" ? args.amountUsd : 0;
        const toAddress = typeof args.toAddress === "string" ? args.toAddress : "";
        if (!(amountUsd > 0)) return err("Ask the founder how much USDC they want to withdraw.");
        let target: Address;
        try {
          target = getAddress(toAddress);
        } catch {
          return err("That withdrawal address isn't a valid 0x… address — ask the founder to double-check it.");
        }
        const amountBase = BigInt(Math.round(amountUsd * 1_000_000));
        const balance = await usdcBalanceBase(b.privyWalletAddress);
        if (amountBase > balance) {
          return ok({
            ok: false,
            insufficient: true,
            requestedUsdc: usd(amountBase),
            balanceUsdc: usd(balance),
            message: `They asked to withdraw ${usd(amountBase)} but the wallet only holds ${usd(balance)} USDC.`,
          });
        }
        putPendingWithdrawal({ chatId, amountBase, toAddress: target });
        return ok({
          ok: true,
          needsConfirmation: true,
          amountUsdc: usd(amountBase),
          toAddress: target,
          message: `Confirm with the founder: withdraw ${usd(amountBase)} USDC to ${target}? Call sage_confirm_withdrawal ONLY after they clearly say yes.`,
        });
      }
      case "sage_confirm_withdrawal": {
        const b = founderBinding(chatId);
        if (!b) return err("There's no agent wallet.");
        // Atomic one-shot consume: returns the prepared withdrawal exactly once (never expired,
        // never already consumed), so a retry — even after a restart — can't double-send.
        const pending = consumePendingWithdrawal(chatId);
        if (!pending) {
          return err("There's no pending withdrawal to confirm (it may have expired) — have the founder request it again first.");
        }
        try {
          const res = await withdrawViaPrivy(b, getAddress(pending.toAddress), pending.amountBase);
          return ok({
            ok: true,
            amountUsdc: usd(pending.amountBase),
            toAddress: pending.toAddress,
            txHash: res.txHash,
            explorerUrl: res.explorerUrl,
            message: `Sent ${usd(pending.amountBase)} USDC to ${pending.toAddress}.`,
          });
        } catch (e) {
          console.error("[agent-wallet-tools] withdraw failed:", e);
          return err(`The withdrawal didn't go through (${e instanceof Error ? e.message : String(e)}). Your funds are safe in the wallet — you can try again.`);
        }
      }
      case "sage_stop_campaign": {
        const b = founderBinding(chatId);
        if (!b) return err("There's no agent wallet yet, so there's no campaign to stop.");
        const campaign = getCampaign(typeof args.campaignId === "string" ? args.campaignId : "");
        if (!campaign) return err("That campaign wasn't found — double-check the campaign id.");
        if (!ownsCampaign(campaign, b.privyWalletAddress)) {
          return err("That campaign wasn't launched from this chat, so this wallet can't stop it.");
        }
        if (!campaign.vaultAddress) return err("That campaign has no on-chain vault to stop.");
        let vault: Address;
        try {
          vault = getAddress(campaign.vaultAddress);
        } catch {
          return err("That campaign's vault address looks invalid.");
        }
        const recoverable = await usdcBalanceBase(vault);
        try {
          const res = await stopCampaignViaPrivy(b, vault);
          setCampaignStatus(campaign.id, "cancelled"); // catalogue it as stopped so it leaves the running list
          return ok({
            ok: true,
            campaignId: campaign.id,
            stopped: true,
            recoveredUsdc: usd(recoverable),
            revokeTx: res.revoke.explorerUrl,
            withdrawTx: res.withdraw.explorerUrl,
            message: `Stopped "${campaign.title}" and returned ${usd(recoverable)} USDC to the founder's Sage wallet — it's in their balance now. They can withdraw it out with sage_request_withdrawal, or leave it for the next campaign.`,
          });
        } catch (e) {
          console.error("[agent-wallet-tools] stop campaign failed:", e);
          return err(`Couldn't stop the campaign (${e instanceof Error ? e.message : String(e)}). No funds moved unless a transaction confirmed — the wallet is safe and you can retry.`);
        }
      }
      case "sage_list_held": {
        const b = founderBinding(chatId);
        if (!b) return err("There's no agent wallet yet — set one up before reviewing campaigns.");
        const campaign = getCampaign(typeof args.campaignId === "string" ? args.campaignId : "");
        if (!campaign) return err("That campaign wasn't found.");
        if (!ownsCampaign(campaign, b.privyWalletAddress))
          return err("That campaign isn't one you launched, so you can't review its submissions.");
        const held = listHeldSubmissions(campaign);
        const stats = autonomousResolutionStats(campaign.id);
        return ok({
          ok: true,
          campaignId: campaign.id,
          count: held.length,
          held: held.map((h) => ({
            submissionId: h.submissionId,
            mission: h.missionTitle,
            // EVIDENCE FIRST: what Sage saw vs the account. The advisory `sageLean` is LAST + deterministic
            // (never a model reading the note) — read the analysis before the lean, and never bulk-approve.
            analysis:
              h.matched != null && h.keySources != null
                ? `matched ${h.matched} of ${h.keySources} things Sage saw firsthand; ${h.reasonClass}`
                : h.reasonClass,
            evidence: h.evidenceUrl,
            sageLean: h.lean, // "pay" | "reject" | "you-decide" — advisory only; the founder decides
            leanWhy: h.leanWhy,
          })),
          autonomy: `${Math.round(stats.rate * 100)}% of this campaign's observation work Sage resolves itself (${stats.wouldPay} would-pay + ${stats.fraudFlagged} flagged of ${stats.total}); ${stats.needsYou} need your judgment.`,
          message: held.length
            ? `${held.length} submission(s) awaiting your review. Read each one's analysis before deciding; I never approve in bulk.`
            : "Nothing is held for review right now.",
        });
      }
      case "sage_release_submission": {
        const b = founderBinding(chatId);
        if (!b) return err("There's no agent wallet yet.");
        const submission = getSubmission(typeof args.submissionId === "string" ? args.submissionId : "");
        if (!submission) return err("That submission wasn't found.");
        const campaign = getCampaign(submission.campaignId);
        if (!campaign) return err("That submission's campaign wasn't found.");
        if (!ownsCampaign(campaign, b.privyWalletAddress))
          return err("That submission is on a campaign you didn't launch.");
        const summary = reviewSummary(campaign, submission.id);
        if ("error" in summary) return err(summary.error);
        putPendingReview(chatId, campaign.id, submission.id);
        const rewardUsdc = usd(BigInt(summary.rewardBase));
        return ok({
          ok: true,
          needsConfirmation: true,
          mission: summary.missionTitle,
          rewardUsdc,
          recipient: summary.recipient,
          message: `Confirm with the founder: release ${rewardUsdc} USDC to ${summary.recipient} for "${summary.missionTitle}"? This settles a real payout. Call sage_confirm_release ONLY after they clearly say yes.`,
        });
      }
      case "sage_confirm_release": {
        const b = founderBinding(chatId);
        if (!b) return err("There's no agent wallet.");
        const pending = consumePendingReview(chatId);
        if (!pending)
          return err("There's no prepared release to confirm (it may have expired) — have the founder pick a held submission again first.");
        const campaign = getCampaign(pending.campaignId);
        if (!campaign || !ownsCampaign(campaign, b.privyWalletAddress))
          return err("That campaign is no longer yours to settle.");
        const res = await releaseSubmission(pending.campaignId, pending.submissionId);
        if (!res.ok) return err(res.error ?? "The release didn't go through.");
        if (res.settled && res.txHash) {
          return ok({
            ok: true,
            settled: true,
            txHash: res.txHash,
            proofUrl: `${appUrl()}/proof/${res.txHash}`,
            message: `Released and paid — proof: ${appUrl()}/proof/${res.txHash}`,
          });
        }
        return ok({
          ok: false,
          settled: false,
          reason: res.reason ?? "not settled",
          message: res.needsOwnerAdd
            ? "The recipient needs to be allowlisted before this can settle."
            : `It didn't settle: ${res.reason ?? "the vault declined it"}. The submission is approved; you can retry.`,
        });
      }
      case "sage_reject_submission": {
        const b = founderBinding(chatId);
        if (!b) return err("There's no agent wallet.");
        const submission = getSubmission(typeof args.submissionId === "string" ? args.submissionId : "");
        if (!submission) return err("That submission wasn't found.");
        const campaign = getCampaign(submission.campaignId);
        if (!campaign) return err("That submission's campaign wasn't found.");
        if (!ownsCampaign(campaign, b.privyWalletAddress))
          return err("That submission is on a campaign you didn't launch.");
        const res = rejectSubmission(campaign.id, submission.id, typeof args.why === "string" ? args.why : undefined);
        if (!res.ok) return err(res.error ?? "Couldn't reject it.");
        return ok({ ok: true, message: "Rejected — no payout, no funds moved." });
      }
      default:
        return err(`unknown agent-wallet tool: ${name}`);
    }
  } catch (e) {
    console.error(`[agent-wallet-tools] ${name} failed:`, e);
    return err(`Something went wrong (${e instanceof Error ? e.message : String(e)}).`);
  }
}
