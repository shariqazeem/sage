import "../../app/app.css";
import "@/styles/tester-board.css";
import "@/styles/wallet-connect.css";
import "@/styles/workspace.css";
import { redirect } from "next/navigation";
import { workspaceContext } from "@/lib/workspaces/context";
import { countMembers, listMembers } from "@/lib/db/workspaces";
import { limitsOf, planOf } from "@/lib/workspaces/plan";
import { PeoplePanel } from "@/components/workspace/people-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "People" };

export default async function PeoplePage() {
  const ctx = await workspaceContext();
  if (!ctx) redirect("/start?next=/workspace/people");
  if (!ctx.owned) redirect("/workspace");
  const ws = ctx.owned;
  return (
    <PeoplePanel
      workspace={{ id: ws.id, name: ws.name, plan: planOf(ws), memberCap: limitsOf(ws).members }}
      members={listMembers(ws.id).map((m) => ({ key: m.memberKey, address: m.address, role: m.role, displayName: m.displayName, joinedAt: m.joinedAt, viaTelegram: m.memberKey.startsWith("tg:") }))}
      memberCount={countMembers(ws.id)}
      me={ctx.memberKey}
    />
  );
}
