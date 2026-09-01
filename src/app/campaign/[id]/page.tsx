import "../../app/app.css";
import "../../app/motion.css";
import "../../app/demo-moments.css";
import { notFound, redirect } from "next/navigation";
import { getCampaign, listSubmissions, getDecisionBySubmission } from "@/lib/db/campaigns";
import { reconcileStopped } from "@/lib/campaigns/reconcile-stopped";
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
import { getFounderAddress, sameFounder } from "@/lib/auth/founder";
import { hasMissionPlan } from "@/lib/campaigns/vault-kind";

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
  // The root layout appends " · Sage" to child segments — naming it here rendered it twice.
  title: "Campaign console",
  description: "Watch your AI agent verify submissions and release payouts, inside on-chain limits it can never exceed.",
};

export default async function CampaignConsolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const loaded = getCampaign(id);
  if (!loaded) notFound();
  /**
   * The V1 policy vaults have no mission plan and no console to show, so they are sent away. A
   * Starknet vault is not one of those — it holds mission terms on chain exactly as a V2 vault
   * does, and its founder needs the same console. Listing only `campaign_v2` bounced every
   * private-capable campaign to the legacy page, which is where a founder found their own live
   * campaign showing nothing.
   */
  if (!hasMissionPlan(loaded.vaultKind)) {
    redirect("/app?legacy=1");
  }
  // The on-chain vault is the truth: if it's been revoked (stopped), reflect that as "cancelled".
  const campaign = await reconcileStopped(loaded);

  const session = await getFounderAddress();
  const isOwner =
    sameFounder(session, campaign.posterWallet);

  const e = v2Economics(campaign);
  const titleByHash = new Map(e.missions.map((m) => [m.missionIdHash, m.title]));
  const rewardByHash = new Map(e.missions.map((m) => [m.missionIdHash, m.rewardBase]));

  // Submissions carry founder-visible tester detail — only compose them for the owner.
  /**
   * THE JUDGE'S CROSS-SUBMISSION WORK, COUNTED — the intelligence the founder paid for, visible.
   * Every decided submission was checked against every other on this campaign (the artifact-twin
   * index and near-duplicate detection are exactly that), and the specific catches are counted by
   * their REAL signal names — never invented, never estimated.
   */
  const integrity = { decided: 0, twins: 0, nearDups: 0, freshWallets: 0, clusters: 0, otherFlags: 0 };

  const submissions: WorkspaceSubmission[] = isOwner
    ? listSubmissions(campaign.id)
        .sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt))
        .map((s) => {
          const decision = getDecisionBySubmission(s.id);
          if (decision) {
            integrity.decided += 1;
            const obs = observationFromRow(decision);
            if (obs?.barReasons?.includes("near_dup")) integrity.nearDups += 1;
            const fb = obs ? null : briefFromRow(decision);
            for (const f of fb?.fraudSignals ?? []) {
              const sig = (f.signal ?? "").toLowerCase();
              if (sig.includes("duplicate artifact")) integrity.twins += 1;
              else if (sig.includes("near-dup") || sig.includes("near dup")) integrity.nearDups += 1;
              else if (sig.includes("fresh wallet")) integrity.freshWallets += 1;
              else if (sig.includes("funded by another submitter")) integrity.clusters += 1;
              else integrity.otherFlags += 1;
            }
          }
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
            id: s.id,
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
            /**
             * THE THING THE FOUNDER ACTUALLY BOUGHT.
             *
             * The console showed wallets, states and confidence — everything ABOUT the work and
             * none OF it. A founder running a feedback campaign would fund it, get four testers,
             * and never see a word any of them wrote. Owner-gated (`isOwner` guards this whole
             * branch) and never public: the tester board and activity feed still show no submitter
             * text, which is a standing safety rule.
             */
            account: s.note ?? null,
            /** what this report was worth — a paid report should say so in money, not just a chip. */
            rewardBase: rewardByHash.get(s.missionIdHash ?? "") ?? null,
          };
        })
    : [];

  const proofBaseTx = submissions.find((s) => s.proofTx)?.proofTx ?? null;

  const data: WorkspaceData = {
    isOwner,
    integrity,
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
