import "../../app/app.css";
import "@/styles/tester-board.css";
import "@/styles/wallet-connect.css";
import "@/styles/workspace.css";
import { getInvite, getWorkspace } from "@/lib/db/workspaces";
import { JoinCard } from "@/components/workspace/join-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = { title: "Join a workspace" };

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const invite = getInvite(code);
  const ws = invite ? getWorkspace(invite.workspaceId) : null;
  const open = !!invite && !!ws && !invite.revokedAt && invite.uses < invite.maxUses;
  return <JoinCard code={code} workspaceName={ws?.name ?? null} open={open} />;
}
