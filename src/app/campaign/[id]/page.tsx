import "../../app/app.css";
import "../../app/motion.css";
import "../../app/demo-moments.css";
import { notFound, redirect } from "next/navigation";
import { getSessionAddress } from "@/lib/auth/session";
import { getCampaign, listSubmissions, getDecisionBySubmission } from "@/lib/db/campaigns";
import { observationFromRow } from "@/lib/deputy/decisions";
import { v2Economics } from "@/lib/campaigns/v2-economics";
import { loadCampaignActivity } from "@/lib/campaigns/load-activity";
import { briefFromRow } from "@/lib/deputy/decisions";
import { chainConfig } from "@/lib/deputy/networks";
import { siteUrl } from "@/lib/site";
import {
  CampaignWorkspace,
  type WorkspaceData,
  type WorkspaceSubmission,
} from "@/components/campaign/campaign-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The founder's campaign console for a live CampaignVaultV2. Owner-gated (the signed-in
 * wallet must be the campaign's `posterWallet`); non-owners see a connect gate that links
 * to the public tester board. Every figure is composed from the canonical DB + economics +
 * proof composers — this route never settles and duplicates no payout logic. V1 policy-vault
 * campaigns are handled by the legacy console.
 */
export const metadata = {
  title: "Campaign console · Sage",
  description: "Watch your AI agent verify submissions and release payouts, inside on-chain limits it can never exceed.",
};

export default async function CampaignConsolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaign = getCampaign(id);
  if (!campaign) notFound();
  if (campaign.vaultKind !== "campaign_v2") redirect("/app?legacy=1");

  const session = await getSessionAddress();
  const isOwner =
    !!session && session.toLowerCase() === campaign.posterWallet.toLowerCase();

  const e = v2Economics(campaign);
  const titleByHash = new Map(e.missions.map((m) => [m.missionIdHash, m.title]));

  // Submissions carry founder-visible tester detail — only compose them for the owner.
  const submissions: WorkspaceSubmission[] = isOwner
    ? listSubmissions(campaign.id)
        .sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt))
        .map((s) => {
          const decision = getDecisionBySubmission(s.id);
          // Observation missions are judged against Sage's own eyes — show the observation verdict
          // (matched N of M), never the url-lane brain's confidence % or evidence_mismatch reason.
          const observation = observationFromRow(decision);
          const brief = observation ? null : decision ? briefFromRow(decision) : null;
          const state: WorkspaceSubmission["state"] =
            s.status === "paid" && s.payoutTx
              ? "paid"
              : observation
                ? "held" // observation missions hold for the founder's review while autopay is off
                : !brief
                  ? "reviewing"
                  : brief.recommendation === "pay"
                    ? "verified"
                    : "held";
          return {
            wallet: s.wallet,
            missionTitle: titleByHash.get(s.missionIdHash ?? "") ?? "Mission",
            state,
            // no url-lane % for observation; the match count is the verdict (leak-safe: counts only).
            confidence: observation ? null : brief?.confidence ?? null,
            reason: observation
              ? `matched ${observation.distinctSources} of ${observation.keyDistinctSources} of Sage's own observations${observation.barPass ? " · clears the bar" : ""}`
              : brief?.reasonCode ?? brief?.summary ?? null,
            proofTx: s.status === "paid" ? s.payoutTx : null,
            at: s.decidedAt ?? s.createdAt,
          };
        })
    : [];

  const proofBaseTx = submissions.find((s) => s.proofTx)?.proofTx ?? null;

  const data: WorkspaceData = {
    isOwner,
    id: campaign.id,
    title: campaign.title,
    description: campaign.descriptionMd ?? "",
    status: campaign.status,
    chainId: e.chainId,
    isTestnet: e.isTestnet,
    autonomy: campaign.autonomy,
    autopilotThreshold: campaign.autopilotThreshold ?? null,
    fundedBase: e.totalFundedBase,
    paidBase: e.paidBase,
    remainingBase: e.remainingBase,
    missionCount: e.missionCount,
    paidCompletions: e.paidCompletions,
    totalCompletions: e.totalCompletions,
    missions: e.missions.map((m) => ({
      title: m.title,
      rewardBase: m.rewardBase,
      maxCompletions: m.maxCompletions,
      paid: m.paid,
      remainingSlots: m.remainingSlots,
      full: m.full,
    })),
    submissions,
    activity: loadCampaignActivity(campaign.id),
    testerUrl: `${siteUrl()}/c/${campaign.id}`,
    vaultAddress: campaign.vaultAddress,
    vaultExplorerUrl: `${chainConfig(e.chainId).explorerUrl}/address/${campaign.vaultAddress}`,
    campaignIdHash: campaign.campaignIdHash ?? null,
    missionPlanDigest: campaign.missionPlanDigest ?? null,
    proofBaseTx,
  };

  return <CampaignWorkspace data={data} />;
}
