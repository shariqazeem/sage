import "../app/app.css";
import "../app/motion.css";
import "@/styles/tester-board.css";
import "@/styles/wallet-connect.css";
import "@/styles/workspace.css";
import { workspaceContext } from "@/lib/workspaces/context";
import { countMembers, listMembers, listWorkspaceCampaigns, workspacesForAddress } from "@/lib/db/workspaces";
import { limitsOf, planOf, proPriceUsd } from "@/lib/workspaces/plan";
import { listSubmissions } from "@/lib/db/campaigns";
import { loadFounderDesk } from "@/lib/campaigns/founder-activity";
import { v2Economics } from "@/lib/campaigns/v2-economics";
import { WorkspaceGate } from "@/components/workspace/workspace-gate";
import { OwnerWorkspace, type OwnerView } from "@/components/workspace/owner-workspace";
import { MemberWorkspace, type MemberView } from "@/components/workspace/member-workspace";
import { sameChainAddress } from "@/lib/campaigns/chain-address";

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
  if (!ctx) return <WorkspaceGate />;

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
        rewardBase: c.rewardAmount,
        paid: subs.filter((s) => s.status === "paid").length,
        pending: subs.filter((s) => s.status === "pending" || s.status === "settling").length,
        slots: e.missions.reduce((n, m) => n + m.maxCompletions, 0),
      };
    });
    const view: OwnerView = {
      workspace: { id: ws.id, name: ws.name, slug: ws.slug, plan: planOf(ws), planUntil: ws.planUntil, memberCap: limitsOf(ws).members, proPriceUsd: proPriceUsd() },
      members: listMembers(ws.id).map((m) => ({ key: m.memberKey, address: m.address, role: m.role, displayName: m.displayName, joinedAt: m.joinedAt, viaTelegram: m.memberKey.startsWith("tg:") })),
      memberCount: countMembers(ws.id),
      campaigns: rows,
      desk: loadFounderDesk(ctx.address, 8),
      me: ctx.memberKey,
    };
    return <OwnerWorkspace view={view} />;
  }

  // a member of someone else's workspace(s)
  const teams = workspacesForAddress(ctx.address);
  if (teams.length === 0) return <WorkspaceGate signedIn address={ctx.address} />;
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
          rewardBase: c.rewardAmount,
          myStatus: mine[0]?.status ?? null,
          myPayoutTx: mine[0]?.payoutTx ?? null,
        };
      }),
  );
  const view: MemberView = { address: ctx.address, teams: teams.map((t) => ({ id: t.id, name: t.name })), work };
  return <MemberWorkspace view={view} />;
}
