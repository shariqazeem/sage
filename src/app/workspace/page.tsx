import "../app/app.css";
import "../app/motion.css";
import "@/styles/tester-board.css";
import "@/styles/wallet-connect.css";
import "@/styles/workspace.css";
import "@/styles/live.css";
import { workspaceContext } from "@/lib/workspaces/context";
import { countMembers, listMembers, listWorkspaceCampaigns, workspacesForAddress } from "@/lib/db/workspaces";
import { limitsOf, planOf } from "@/lib/workspaces/plan";
import { listSubmissions } from "@/lib/db/campaigns";
import { loadFounderDesk } from "@/lib/campaigns/founder-activity";
import { v2Economics } from "@/lib/campaigns/v2-economics";
import { redirect } from "next/navigation";
import { OwnerWorkspace, type HomeAccount, type OwnerView } from "@/components/workspace/owner-workspace";
import { MemberWorkspace, type MemberView } from "@/components/workspace/member-workspace";
import { sameChainAddress } from "@/lib/campaigns/chain-address";
import { founderChain } from "@/lib/auth/founder";
import { launchClosedReason } from "@/lib/launch/deployment-service";
import { billingView } from "@/lib/plans/billing-view";
import { chainConfig } from "@/lib/deputy/networks";
import { effectivePlan, founderUsage } from "@/lib/plans/founder-plan";
import { getMandate } from "@/lib/db/operator";
import { treasuryChainId } from "@/lib/privy/onboarding";
import { getWebTreasury, webTreasuryOpening } from "@/lib/treasury/web";
import { webTreasuryStatus } from "@/lib/treasury/launch";
import { accountUnavailableBecause } from "@/lib/treasury/summary";

/** The account as Home shows it: balances when it is open, and otherwise the plain state. */
async function homeAccount(founder: string): Promise<HomeAccount> {
  const because = accountUnavailableBecause(founder);
  const home = treasuryChainId();
  const network = chainConfig(home).name;
  if (because) return { state: because, network };
  const t = getWebTreasury(founder);
  if (!t) {
    if (webTreasuryOpening(founder, home)) return { state: "opening", network };
    const closed = launchClosedReason(home);
    return closed ? { state: "closed", network, reason: closed } : { state: "none", network };
  }
  const c = chainConfig(t.chainId);
  const s = await webTreasuryStatus(founder, t.chainId);
  return {
    state: "open",
    network: c.name,
    nativeSymbol: c.nativeSymbol,
    usdc: s?.balanceUsd ?? 0,
    gasWei: s?.gasWei ?? null,
    gasUsd: s?.gasUsd ?? null,
    launchFloorWei: s?.launchFloorWei ?? "0",
    usdcIsGas: c.nativeSymbol === "USDC",
    canSwap: s?.canSwap ?? false,
  };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Workspace",
  description: "Your team's work, members and payouts — verified and paid by Sage inside limits you set.",
};

/**
 * SAGE FOR TEAMS — the closed loop's home. An owner sees the workspace: open work, members with an
 * invite link, the plan, and Sage's recent work. A member sees the work their teams have open, what
 * they've submitted and how it went. A signed-in founder without a workspace names one.
 */
export default async function WorkspacePage() {
  const ctx = await workspaceContext();
  if (!ctx) redirect("/start?next=/workspace");

  if (ctx.owned) {
    const ws = ctx.owned;
    const campaigns = listWorkspaceCampaigns(ws).filter((c) => !c.sandbox);
    const rows: OwnerView["campaigns"] = campaigns.map((c) => {
      const e = v2Economics(c);
      const subs = listSubmissions(c.id);
      return {
        id: c.id,
        title: c.title,
        kind: c.kind,
        status: c.status,
        visibility: c.visibility,
        rail: c.settlementRail,
        chainId: c.chainId ?? null,
        rewardBase: c.rewardAmount,
        paid: subs.filter((s) => s.status === "paid").length,
        pending: subs.filter((s) => s.status === "pending" || s.status === "settling").length,
        slots: e.missions.reduce((n, m) => n + m.maxCompletions, 0),
        paidBase: subs.filter((s) => s.status === "paid").length * c.rewardAmount,
      };
    });
    const view: OwnerView = {
      workspace: { id: ws.id, name: ws.name, slug: ws.slug, plan: planOf(ws), planUntil: ws.planUntil, memberCap: limitsOf(ws).members, proPriceUsd: 0 },
      members: listMembers(ws.id).map((m) => ({ key: m.memberKey, address: m.address, role: m.role, displayName: m.displayName, joinedAt: m.joinedAt, viaTelegram: m.memberKey.startsWith("tg:") })),
      memberCount: countMembers(ws.id),
      campaigns: rows,
      desk: loadFounderDesk(ctx.address, 8),
      me: ctx.memberKey,
      chain: founderChain(ctx.address) ?? "evm",
      usage: (() => {
        const u = founderUsage(ctx.address);
        return { plan: effectivePlan(ctx.address), liveJobs: u.liveJobs, launchedUsd: Number(u.launchedBase) / 1e6 };
      })(),
      account: await homeAccount(ctx.address),
      autopilotArmed: getMandate(ctx.address)?.enabled === 1,
      // The chain is read only when a renewal is close or failed, so an ordinary Home load costs nothing.
      billingNotice: founderChain(ctx.address) === "evm" ? (await billingView(ctx.address, { readBalance: "when-relevant" })).notice : null,
    };
    return <OwnerWorkspace view={view} />;
  }

  // a member of someone else's workspace(s)
  const teams = workspacesForAddress(ctx.address);
  if (teams.length === 0) redirect("/start");
  const work: MemberView["work"] = teams.flatMap((ws) =>
    listWorkspaceCampaigns(ws)
      .filter((c) => c.status === "live" && !c.sandbox)
      .map((c) => {
        const mine = listSubmissions(c.id).filter((s) => sameChainAddress(s.wallet, ctx.address));
        return {
          id: c.id,
          title: c.title,
          team: ws.name,
          kind: c.kind,
          rail: c.settlementRail,
          chainId: c.chainId ?? null,
          rewardBase: c.rewardAmount,
          myStatus: mine[0]?.status ?? null,
          myPayoutTx: mine[0]?.payoutTx ?? null,
        };
      }),
  );
  const view: MemberView = { address: ctx.address, teams: teams.map((t) => ({ id: t.id, name: t.name })), work };
  return <MemberWorkspace view={view} />;
}
