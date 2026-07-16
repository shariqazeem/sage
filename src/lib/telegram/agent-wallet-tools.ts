import "server-only";

import { erc20Abi, getAddress, type Address } from "viem";

import type { McpToolDef, ToolResult } from "@/lib/mcp/server";
import { founderBinding, onboardWalletless } from "@/lib/privy/onboarding";
import { deployCampaignViaPrivy } from "@/lib/privy/deploy-runner";
import { withdrawViaPrivy } from "@/lib/privy/withdraw";
import { getInspectionJob } from "@/lib/db/inspection";
import { getCurrentRevision, approveRevision } from "@/lib/db/plan-revisions";
import { verifyPlanForApproval } from "@/lib/launch/approve";
import { deserializePlan } from "@/lib/launch/serde";
import { MISSION_PROMPT_VERSION } from "@/lib/launch/mission-prompt";
import { loadApprovedPlan } from "@/lib/launch/deployment-service";
import { deriveDeploymentInputs } from "@/lib/launch/deploy-plan";
import { publicClient } from "@/lib/deputy/chain";
import { GOAT_USDC } from "@/lib/deputy/networks";

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

// A withdrawal the founder requested but hasn't yet confirmed. Kept server-side (not in the model's
// hands) so the confirmed transfer is EXACTLY what was prepared — the agent can't alter the amount
// or recipient at confirm time. In-memory + short-lived; a restart just means re-requesting.
interface PendingWithdrawal {
  toAddress: Address;
  amountBase: bigint;
  expiresAt: number;
}
const pendingWithdrawals = new Map<string, PendingWithdrawal>();
const WITHDRAW_TTL_MS = 5 * 60 * 1000;

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
  return approveRevision(jobId, current.revisionNumber, approver, verified.approvalRecord).ok;
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
            message: `This founder already has an agent wallet (${existing.privyWalletAddress}). To add funds, send USDC there.`,
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
          message: `Agent wallet created on GOAT: ${result.privyWalletAddress}. Tell the founder to send USDC plus a little native BTC for gas (BTC is GOAT's native gas token) to it — you can spend up to ${capUsd} USDC per campaign, and any leftover stays as their balance.`,
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
        pendingWithdrawals.set(chatId, { toAddress: target, amountBase, expiresAt: Date.now() + WITHDRAW_TTL_MS });
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
        const pending = pendingWithdrawals.get(chatId);
        if (!pending || pending.expiresAt < Date.now()) {
          pendingWithdrawals.delete(chatId);
          return err("There's no pending withdrawal to confirm (it may have expired) — have the founder request it again first.");
        }
        pendingWithdrawals.delete(chatId); // one-shot: consume before executing so a retry can't double-send
        try {
          const res = await withdrawViaPrivy(b, pending.toAddress, pending.amountBase);
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
      default:
        return err(`unknown agent-wallet tool: ${name}`);
    }
  } catch (e) {
    console.error(`[agent-wallet-tools] ${name} failed:`, e);
    return err(`Something went wrong (${e instanceof Error ? e.message : String(e)}).`);
  }
}
