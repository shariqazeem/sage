import "server-only";

import type { AgentKeyScope } from "@/lib/db/schema";
import { MCP_TOOLS, callSageTool, type McpContext, type McpToolDef, type ToolResult } from "./server";
import { DIRECT_CAMPAIGN_TOOL, MY_CAMPAIGNS_TOOL } from "@/lib/telegram/concierge";
import { listLaunchablePlans } from "@/lib/campaigns/launchable";
import { launchFromTreasury, webTreasuryStatus } from "@/lib/treasury/launch";
import { getWebTreasury } from "@/lib/treasury/web";
import { accountUnavailableBecause } from "@/lib/treasury/summary";
import { formatNative } from "@/lib/treasury/gas-policy";
import { chainConfig } from "@/lib/deputy/networks";

/**
 * THE TOOLS AN OWNER'S OWN AGENT GETS (24 Oct 2026, "connect your own AI agent").
 *
 * The same MCP tools every agent sees, plus the founder's own: their jobs, their plans, their account,
 * and (with the launch scope) launching a ready plan from their account. Identity is the key's, bound
 * here SERVER-SIDE: a tool argument can never name another founder, and a caller-supplied
 * `founderOverride` or `clientRef` is dropped before any tool sees it. Each tool belongs to exactly
 * one scope, and a key without that scope neither lists nor runs it.
 */

const SCOPE_OF: Record<string, AgentKeyScope> = {
  sage_get_inspection: "read",
  sage_get_campaign: "read",
  sage_get_submission: "read",
  sage_get_proof: "read",
  sage_example_plan: "read",
  sage_browse_missions: "read",
  sage_my_campaigns: "read",
  sage_account: "read",
  sage_start_inspection: "plan",
  sage_answer_questions: "plan",
  sage_first_look: "plan",
  sage_check_evidence: "plan",
  sage_goal_checkpoints: "plan",
  sage_create_direct_campaign: "plan",
  sage_launch_from_account: "launch",
};

const ACCOUNT_TOOL: McpToolDef = {
  name: "sage_account",
  description:
    "Read the owner's Sage account: its network, address, USDC balance, the METIS it holds for network fees, and the most Sage may put into one job. Read-only. Use before launching, and to answer 'how much is in my account?'. Never compare the balance to a budget yourself: sage_launch_from_account checks that and says exactly what is missing.",
  inputSchema: { type: "object", properties: {} },
};

const LAUNCH_TOOL: McpToolDef = {
  name: "sage_launch_from_account",
  description:
    "Fund and launch a READY plan from the owner's Sage account, inside the account's per-job limit and the owner's plan limits — exactly what their own Launch button does. It moves real USDC from the account into the job's on-chain vault, which then pays people for verified work. inspectionId is OPTIONAL: omit it to launch the owner's most recent ready plan (sage_my_campaigns lists them under readyToLaunch). Returns the live job, or exactly why it can't launch yet (needsFunding, needsGas, overCap, plan_limit).",
  inputSchema: {
    type: "object",
    properties: { inspectionId: { type: "string", description: "OPTIONAL. The ready plan to launch." } },
  },
};

const ALL_TOOLS: McpToolDef[] = [...MCP_TOOLS, MY_CAMPAIGNS_TOOL as McpToolDef, DIRECT_CAMPAIGN_TOOL as unknown as McpToolDef, ACCOUNT_TOOL, LAUNCH_TOOL];

/** The tools a key with these scopes may see, in a stable order. */
export function workspaceTools(scopes: ReadonlySet<AgentKeyScope>): McpToolDef[] {
  return ALL_TOOLS.filter((t) => {
    const scope = SCOPE_OF[t.name];
    return scope !== undefined && scopes.has(scope);
  });
}

const json = (obj: unknown, isError = false): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }], isError });
const siteUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://sagepays.xyz").replace(/\/$/, "");

export interface WorkspaceToolContext {
  /** the owner the key acts as (their sign-in address) */
  founder: string;
  scopes: ReadonlySet<AgentKeyScope>;
  scheduleAfter: McpContext["scheduleAfter"];
}

/** Run one tool for an owner's agent. Null for a name this surface doesn't have. */
export async function callWorkspaceTool(name: string, rawArgs: Record<string, unknown>, ctx: WorkspaceToolContext): Promise<ToolResult | null> {
  const scope = SCOPE_OF[name];
  if (!scope) return null;
  if (!ctx.scopes.has(scope)) return json({ ok: false, error: `This key isn't allowed to ${scope === "launch" ? "launch jobs" : "plan work"}. The workspace owner can grant it in Settings, AI agents.` }, true);
  // Identity is the key's: anything a caller sent to name a founder is dropped.
  const { founderOverride: _drop, clientRef: _ref, ...args } = rawArgs;
  void _drop;
  void _ref;

  if (name === "sage_account") {
    const because = accountUnavailableBecause(ctx.founder);
    if (because) return json({ ok: true, exists: false, reason: because === "starknet" ? "A Starknet sign-in has no Sage account. Sage runs on Metis: an email or MetaMask sign-in opens one." : "Accounts aren't configured on this deployment." });
    const t = getWebTreasury(ctx.founder);
    if (!t) return json({ ok: true, exists: false, reason: "The owner hasn't opened a Sage account yet.", openAt: `${siteUrl()}/workspace/account` });
    const s = await webTreasuryStatus(ctx.founder, t.chainId);
    const c = chainConfig(t.chainId);
    return json({
      ok: true,
      exists: true,
      network: c.name,
      address: t.privyWalletAddress,
      balanceUsdc: s?.balanceUsd ?? null,
      feeToken: c.nativeSymbol,
      feeBalance: s?.gasWei == null ? null : formatNative(BigInt(s.gasWei)),
      enoughToLaunch: s?.enoughGas ?? null,
      perJobLimitUsd: s?.perCampaignCapUsd ?? t.perCampaignCapBase / 1e6,
      note: "INFORMATIONAL. Never compare the balance to a budget yourself; sage_launch_from_account decides.",
    });
  }

  if (name === "sage_launch_from_account") {
    const asked = typeof args.inspectionId === "string" ? args.inspectionId.trim() : "";
    const jobId = asked || listLaunchablePlans(ctx.founder)[0]?.inspectionId || "";
    if (!jobId) return json({ ok: false, error: "There's no ready plan to launch. Plan one first: sage_start_inspection (product testing) or sage_create_direct_campaign (a gig or a grant)." }, true);
    const r = await launchFromTreasury(ctx.founder, jobId);
    if (!r.ok) return json({ ok: false, reason: r.reason, message: r.message, ...(r.upgradeTo ? { upgradeTo: r.upgradeTo, upgradeUrl: `${siteUrl()}/pricing` } : {}) });
    return json({ ok: true, campaignId: r.campaignId, vault: r.vault, campaignUrl: `${siteUrl()}/c/${r.campaignId}`, launchTxs: r.steps.map((s) => s.explorerUrl), message: "Live. Sage checks every submission and pays verified work from the vault." });
  }

  // Everything else is the shared tool, run with the owner bound server-side.
  const bound: Record<string, unknown> = name === "sage_start_inspection" ? { ...args, founderOverride: ctx.founder.toLowerCase() } : args;
  return callSageTool(name, bound, { scheduleAfter: ctx.scheduleAfter, founderWallet: ctx.founder });
}
