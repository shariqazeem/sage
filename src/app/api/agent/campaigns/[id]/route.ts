import { NextResponse, type NextRequest } from "next/server";

import { authenticateAgent } from "@/lib/agent-api/auth";
import { getCampaign, listSubmissions, getDecisionBySubmission } from "@/lib/db/campaigns";
import { v2Economics } from "@/lib/campaigns/v2-economics";
import { briefFromRow } from "@/lib/deputy/decisions";
import { submissionState } from "@/lib/agent-api/views";
import { reward, networkLabel, short } from "@/lib/format";
import { explorerTxUrl } from "@/lib/deputy/networks";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/campaigns/[id] — campaign status + activity for the ClawUp agent to report:
 * live/paused/closed, network + truthful token, funded/paid/remaining, mission slots, and
 * the recent tester submissions with the Deputy's decision truth + payout tx + proof link.
 * All from the canonical economics/decision composers. Public-safe: no evidence text, no
 * founder-private data. Read-only.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = authenticateAgent(req);
  if (!auth.ok) return auth.res;

  const { id } = await ctx.params;
  const campaign = getCampaign(id);
  if (!campaign) return NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });
  if (campaign.vaultKind !== "campaign_v2") {
    return NextResponse.json({ ok: false, error: "Not a mission-board (V2) campaign." }, { status: 400 });
  }

  const e = v2Economics(campaign);
  const base = siteUrl();
  const titleByHash = new Map(e.missions.map((m) => [m.missionIdHash, m.title]));

  const submissions = listSubmissions(campaign.id)
    .sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt))
    .slice(0, 25)
    .map((s) => {
      const decision = getDecisionBySubmission(s.id);
      const brief = decision ? briefFromRow(decision) : null;
      const state = submissionState(s, brief);
      return {
        submissionId: s.id,
        tester: short(s.wallet),
        mission: titleByHash.get(s.missionIdHash ?? "") ?? "Mission",
        state,
        confidence: brief?.confidence ?? null,
        reason: brief?.reasonCode ?? null,
        payoutTx: state === "paid" ? s.payoutTx : null,
        explorerUrl: state === "paid" && s.payoutTx ? explorerTxUrl(e.chainId, s.payoutTx) : null,
        proofUrl: state === "paid" && s.payoutTx ? `${base}/proof/${s.payoutTx}` : null,
      };
    });

  return NextResponse.json({
    ok: true,
    campaignId: campaign.id,
    title: campaign.title,
    status: campaign.status, // live / paused / completed
    network: networkLabel(e.chainId),
    chainId: e.chainId,
    isTestnet: e.isTestnet,
    token: e.tokenSymbol,
    autonomy: campaign.autonomy, // manual | autopilot
    funded: { base: e.totalFundedBase, human: reward(e.totalFundedBase, e.chainId) },
    paid: { base: e.paidBase, human: reward(e.paidBase, e.chainId) },
    remaining: { base: e.remainingBase, human: reward(e.remainingBase, e.chainId) },
    missions: e.missions.map((m) => ({
      title: m.title,
      reward: reward(m.rewardBase, e.chainId),
      paid: m.paid,
      maxCompletions: m.maxCompletions,
      remainingSlots: m.remainingSlots,
      full: m.full,
    })),
    submissions,
    boardUrl: `${base}/c/${campaign.id}`,
    consoleUrl: `${base}/campaign/${campaign.id}`,
  });
}
