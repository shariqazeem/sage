import Link from "next/link";
import { notFound } from "next/navigation";
import { SageMark } from "@/components/brand/sage-mark";
import { getAddress } from "viem";
import { Check, ShieldCheck } from "lucide-react";
import { usd, reward as fmtReward, networkLabel } from "@/lib/format";
import {
  ensureFlagshipCampaign,
  getCampaign,
  listSubmissions,
} from "@/lib/db/campaigns";
import { getVaultState } from "@/lib/deputy/chain";
import { v2Economics } from "@/lib/campaigns/v2-economics";
import { BudgetRing } from "@/components/app/budget-ring";
import { NetworkChip } from "@/components/app/network-chip";
import { SubmitPanel } from "@/components/campaigns/submit-panel";
import { V2Board, HowYouGetPaid, TesterFaq } from "@/components/campaigns/v2-board";
import { SageActivity } from "@/components/campaigns/sage-activity";
import { PublicFeed } from "@/components/campaigns/public-feed";
import { loadCampaignActivity } from "@/lib/campaigns/load-activity";
import "@/styles/tester-board.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public, shareable campaign page — the growth artifact a stranger meets cold.
 * Re-skinned to the app's design language: the BudgetRing motif reads the
 * campaign's reward pool live, the settled feed links each payout to its on-chain
 * proof, and the submit panel is the same input/button system as the app.
 */
export default async function CampaignPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  ensureFlagshipCampaign();
  const campaign = getCampaign(slug);
  if (!campaign) notFound();

  // ── V2 mission-board campaign — real per-mission economics, testnet-truthful ──
  if (campaign.vaultKind === "campaign_v2") {
    const e = v2Economics(campaign);
    const live = campaign.status === "live";
    const pct = e.totalFundedBase > 0 ? Math.round((e.paidBase / e.totalFundedBase) * 100) : 0;
    const activity = loadCampaignActivity(campaign.id);
    // the campaign is complete when every paid slot is filled, or it's no longer live.
    const complete = !live || (e.totalCompletions > 0 && e.paidCompletions >= e.totalCompletions);
    return (
      <main className="sb-shell">
        <header className="sb-top">
          <Link href="/" className="sb-brand" style={{ textDecoration: "none" }}>
            <SageMark size={20} /> Sage
          </Link>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <NetworkChip chainId={e.chainId} size="xs" />
            <span className="sb-net"><span className="dot" /> Reward campaign</span>
          </span>
        </header>

        <div className="sage-agent-card" style={{ marginBottom: 16 }}>
          <div className="sage-eyebrow"><ShieldCheck size={13} /> Paid from a founder-owned vault with hard on-chain limits</div>
          <h1 style={{ fontSize: 27, fontWeight: 700, letterSpacing: "-0.025em", margin: "0 0 8px" }}>{campaign.title}</h1>
          {campaign.descriptionMd && (
            <p style={{ fontSize: 15, color: "var(--sec)", lineHeight: 1.55, margin: 0 }}>{campaign.descriptionMd}</p>
          )}

          <div className="v2-econ">
            <div className="v2-econ-row">
              <div className="v2-econ-fig"><span className="k">Funded</span><span className="v mono">{fmtReward(e.totalFundedBase, e.chainId)}</span></div>
              <div className="v2-econ-fig"><span className="k">Paid</span><span className="v mono">{fmtReward(e.paidBase, e.chainId)}</span></div>
              <div className="v2-econ-fig"><span className="k">Remaining</span><span className="v mono">{fmtReward(e.remainingBase, e.chainId)}</span></div>
            </div>
            <div className="v2-econ-bar"><span style={{ width: `${pct}%` }} /></div>
            <div className="v2-econ-meta">
              <span>{networkLabel(e.chainId)}</span>
              <span>·</span>
              <span>{e.missionCount} mission{e.missionCount === 1 ? "" : "s"}</span>
              <span>·</span>
              <span>{e.paidCompletions}/{e.totalCompletions} paid</span>
              <span>·</span>
              <span>{live ? "Live" : "Closed"}</span>
            </div>
            {e.isTestnet && (
              <p className="v2-testnote">Payouts here are real on-chain testnet transactions. Test mUSDC has no monetary value.</p>
            )}
          </div>
        </div>

        <HowYouGetPaid />

        <div className="sb-sec-label">Missions</div>
        <V2Board
          campaignId={campaign.id}
          campaignIdHash={campaign.campaignIdHash ?? `0x${"0".repeat(64)}`}
          chainId={e.chainId}
          live={live}
          missions={e.missions}
        />

        <SageActivity campaignId={campaign.id} chainId={e.chainId} initial={activity} pending={activity.pending} complete={complete} />

        <TesterFaq perWalletCap={campaign.perWalletPayoutCap} />

        <footer className="sage-hint" style={{ padding: "24px 2px 60px" }}>
          You own the campaign vault; Sage is the bounded operator. It reviews each submission
          and pays eligible work within your on-chain limits — it can never exceed the budget,
          the per-mission reward, or the completion caps. Every payout is a verifiable
          transaction you can inspect on the block explorer.
        </footer>
      </main>
    );
  }

  const rewardUsd = campaign.rewardAmount / 1_000_000;
  const subs = listSubmissions(campaign.id);
  const paidSubs = subs
    .filter((s) => s.status === "paid" && s.payoutTx)
    .sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt));
  const paid = paidSubs.length;
  const seatsLeft =
    campaign.maxRecipients > 0 ? Math.max(0, campaign.maxRecipients - paid) : null;
  const live = campaign.status === "live";

  // The ring reads the campaign's reward pool when the campaign is capped;
  // otherwise the funding vault's live balance. Resilient — falls back gracefully.
  const vault = await getVaultState(getAddress(campaign.vaultAddress)).catch(
    () => null,
  );
  const capped = campaign.maxRecipients > 0;
  const ringBudget = capped ? rewardUsd * campaign.maxRecipients : vault?.budget ?? 0;
  const ringRemaining = capped
    ? Math.max(0, ringBudget - paid * rewardUsd)
    : vault?.remaining ?? 0;

  return (
    <main className="sb-shell">
      <header className="sb-top">
        <Link href="/" className="sb-brand" style={{ textDecoration: "none" }}>
          <SageMark size={20} /> Sage
        </Link>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <NetworkChip chainId={campaign.chainId} size="xs" />
          <span className="sb-net">
            <span className="dot" /> Reward campaign
          </span>
        </span>
      </header>

      <div className="sage-agent-card" style={{ marginBottom: 16 }}>
        <div className="sage-eyebrow">
          <ShieldCheck size={13} /> Paid from an on-chain wallet with hard spending limits
        </div>
        <h1
          style={{
            fontSize: 27,
            fontWeight: 700,
            letterSpacing: "-0.025em",
            margin: "0 0 10px",
          }}
        >
          {campaign.title}
        </h1>
        {campaign.descriptionMd && (
          <p
            style={{
              fontSize: 15,
              color: "var(--sec)",
              lineHeight: 1.55,
              margin: 0,
            }}
          >
            {campaign.descriptionMd}
          </p>
        )}

        <div className="sage-ring-wrap">
          <BudgetRing remaining={ringRemaining} budget={ringBudget} size={210} />
        </div>

        <div className="sage-metarow">
          <span className="sage-metachip reward">
            <span className="k">Reward</span>
            <span className="v mono">{usd(rewardUsd)}</span>
          </span>
          <span className="sage-metachip">
            <span className="k">Paid</span>
            <span className="v mono">
              {paid}
              {capped ? `/${campaign.maxRecipients}` : ""}
            </span>
          </span>
          {seatsLeft !== null && (
            <span className="sage-metachip">
              <span className="k">Seats left</span>
              <span className="v mono">{seatsLeft}</span>
            </span>
          )}
          <span className="sage-metachip">
            <span className="k">Status</span>
            <span className="v">{live ? "Live" : "Closed"}</span>
          </span>
        </div>

        {campaign.criteria.length > 0 && (
          <ul className="sage-crit" style={{ marginTop: 22 }}>
            {campaign.criteria.map((c, i) => (
              <li key={i}>
                <Check size={15} />
                {c}
              </li>
            ))}
          </ul>
        )}
      </div>

      <PublicFeed
        campaignId={campaign.id}
        rewardUsd={rewardUsd}
        initial={{
          paid,
          verifying: subs.filter(
            (s) => s.status === "pending" || s.status === "settling",
          ).length,
          feed: paidSubs
            .flatMap((s) =>
              s.payoutTx
                ? [{ wallet: s.wallet, payoutTx: s.payoutTx, at: s.decidedAt ?? s.createdAt }]
                : [],
            )
            .slice(0, 12),
        }}
      />

      <div className="sb-sec-label">Submit your entry</div>
      <SubmitPanel
        campaignId={campaign.id}
        live={live}
        rewardUsd={rewardUsd}
        threshold={campaign.autopilotThreshold}
      />

      <div className="sb-sec-label">Fair play</div>
      <ul className="sage-crit" style={{ marginTop: 6 }}>
        <li>
          <Check size={15} />
          Each wallet can earn up to {campaign.perWalletPayoutCap} payout
          {campaign.perWalletPayoutCap === 1 ? "" : "s"} in this campaign, and one per mission.
        </li>
        <li>
          <Check size={15} />
          Copied or near-identical reports are detected and held for a person to review — never
          auto-paid. Honest work in your own words is fine.
        </li>
        <li>
          <Check size={15} />
          Brand-new wallets are noted as a caution for review; that alone never blocks a payout.
        </li>
      </ul>

      <footer className="sage-hint" style={{ padding: "24px 2px 60px" }}>
        Rewards are paid by Sage from an on-chain wallet with hard
        spending limits (the Policy Vault). Every payout is a verifiable
        transaction you can inspect on the block explorer.
      </footer>
    </main>
  );
}
