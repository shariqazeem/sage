import "../../app/app.css";
import "@/styles/tester-board.css";
import "@/styles/wallet-connect.css";
import "@/styles/workspace.css";
import { getInvite, getWorkspace } from "@/lib/db/workspaces";
import { JoinCard } from "@/components/workspace/join-card";
import { SeatCard } from "@/components/people/seat-card";
import { seatLinkPublic } from "@/lib/people/link-info";
import { getJobLink, isSeatCode } from "@/lib/people/seats";
import { currentRound } from "@/lib/programmes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = { title: "Join" };

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const emailEnabled = !!process.env.NEXT_PUBLIC_PRIVY_LOGIN_APP_ID?.trim();
  // A job's own link for its people (6 Nov 2026): one link, N places, on every plan.
  if (isSeatCode(code)) {
    const link = getJobLink(code);
    const open = link && !link.revokedAt;
    const view = open ? seatLinkPublic(link, link.programmeId ? currentRound(link.programmeId).campaignId : null) : null;
    return <SeatCard code={code} view={view} emailEnabled={emailEnabled} />;
  }
  const invite = getInvite(code);
  const ws = invite ? getWorkspace(invite.workspaceId) : null;
  const open = !!invite && !!ws && !invite.revokedAt && invite.uses < invite.maxUses;
  return <JoinCard code={code} workspaceName={ws?.name ?? null} open={open} emailEnabled={emailEnabled} />;
}
