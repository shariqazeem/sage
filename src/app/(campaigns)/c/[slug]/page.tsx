import Link from "next/link";
import { notFound } from "next/navigation";
import { getAddress } from "viem";
import { Check, ShieldCheck } from "lucide-react";
import { usd } from "@/lib/format";
import {
  ensureFlagshipCampaign,
  getCampaign,
  listSubmissions,
} from "@/lib/db/campaigns";
import { getVaultState } from "@/lib/deputy/chain";
import { BudgetRing } from "@/components/app/budget-ring";
import { NetworkChip } from "@/components/app/network-chip";
import { SubmitPanel } from "@/components/campaigns/submit-panel";
import { PublicFeed } from "@/components/campaigns/public-feed";

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
          <span className="sb-mark">S</span> Sage
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

      <footer className="sage-hint" style={{ padding: "24px 2px 60px" }}>
        Rewards are paid by Sage&apos;s Deputy from an on-chain wallet with hard
        spending limits (the Policy Vault). Every payout is a verifiable
        transaction you can inspect on the block explorer.
      </footer>
    </main>
  );
}
