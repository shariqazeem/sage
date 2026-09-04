// the mission-verify prompt lives inside the board; its styles belong to the PAGE, because a
// component that imports CSS drags PostCSS into every component test that renders it
import "@/styles/live.css";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SageMark } from "@/components/brand/sage-mark";
import { getAddress } from "viem";
import { Check, ShieldCheck } from "lucide-react";
import { usd, reward as fmtReward, networkLabel, rewardAligned as fmtRewardAligned } from "@/lib/format";
import {
  ensureFlagshipCampaign,
  getCampaign,
  listSubmissions,
} from "@/lib/db/campaigns";
import { getVaultState } from "@/lib/deputy/chain";
import {
  readVaultBalance as readStarknetVaultBalance,
  readVaultState as readStarknetVaultState,
} from "@/lib/starknet/vault";
import { v2Economics } from "@/lib/campaigns/v2-economics";
import { campaignAutopays } from "@/lib/campaigns/autopay-status";
import { BudgetRing } from "@/components/app/budget-ring";
import { NetworkChip } from "@/components/app/network-chip";
import { SubmitPanel } from "@/components/campaigns/submit-panel";
import { V2Board, HowYouGetPaid, TesterFaq } from "@/components/campaigns/v2-board";
import { identityDoorArmed } from "@/lib/identity/door";
import { isPublicWork } from "@/lib/campaigns/visibility";
import { worldIdConfig } from "@/lib/identity/worldid";
import { ExploredBanner } from "@/components/campaigns/explored-banner";
import { SageActivity } from "@/components/campaigns/sage-activity";
import { PublicFeed } from "@/components/campaigns/public-feed";
import { loadCampaignActivity } from "@/lib/campaigns/load-activity";
import "@/styles/tester-board.css";
import "@/styles/wallet-connect.css";
import "@/styles/marketplace.css";
import { hasMissionPlan } from "@/lib/campaigns/vault-kind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public, shareable campaign page — the growth artifact a stranger meets cold.
 * Re-skinned to the app's design language: the BudgetRing motif reads the
 * campaign's reward pool live, the settled feed links each payout to its on-chain
 * proof, and the submit panel is the same input/button system as the app.
 */
/**
 * THE CARD A LINK SHOWS. For a single-deliverable gig the mission IS the campaign, so the card
 * carries the mission's title and its price — not "Testing campaign · host" (the V2 deploy's default
 * name, which a direct gig inherited on launch day) and not the testing boilerplate.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = getCampaign(slug);
  const head = c ? boardHeadline(c) : null;
  return {
    // The layout template appends "· Sage"; adding it here rendered it twice in the tab.
    title: head?.title ?? "Reward campaign",
    description:
      head?.description ??
      "A paid testing mission on Sage. Do the work, submit your evidence, and an AI agent pays you real USDC from an on-chain vault — every payout a verifiable receipt.",
    openGraph: head ? { title: head.title, description: head.description, images: ["/opengraph-image"] } : undefined,
    twitter: head ? { card: "summary_large_image", title: head.title, description: head.description, images: ["/opengraph-image"] } : undefined,
  };
}

/** The title and one-line description a board presents — the mission's own for a single-deliverable gig. */
function boardHeadline(c: NonNullable<ReturnType<typeof getCampaign>>): { title: string; description: string } {
  const e = hasMissionPlan(c.vaultKind) ? v2Economics(c) : null;
  const one = e && e.missions.length === 1 ? e.missions[0] : null;
  const rail = c.vaultKind === "sage_vault_starknet" ? "Starknet — privately, if you choose" : "GOAT Network";
  const isDirect = c.kind === "gig" || c.kind === "grant";
  if (isDirect && one) {
    const each = (one.rewardBase / 1_000_000).toLocaleString("en-US", { style: "currency", currency: "USD" });
    return {
      title: one.title,
      description: `${each} for each of ${one.maxCompletions} ${one.maxCompletions === 1 ? "person" : "people"}, verified and paid by an AI agent on ${rail}. No application, no interview, no human approving the payout.`,
    };
  }
  return {
    title: c.title,
    description: `A paid ${isDirect ? "gig" : "testing mission"} on Sage. Do the work, submit your evidence, and an AI agent pays you USDC from an on-chain vault on ${rail} — every payout a verifiable receipt.`,
  };
}

export default async function CampaignPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  ensureFlagshipCampaign();
  const campaign = getCampaign(slug);
  if (!campaign) notFound();

  /**
   * ── The mission board — real per-mission economics, testnet-truthful ──
   *
   * Gated on `campaign_v2` alone, so a Starknet campaign fell through to the legacy single-reward
   * board: no mission list, no Sage activity, no exploration line, none of the things that make a
   * tester believe the payout is real. A Starknet vault carries exactly the same per-mission
   * economics; the economics helper below never cared which chain it was.
   */
  if (hasMissionPlan(campaign.vaultKind)) {
    const e = v2Economics(campaign);
    const live = campaign.status === "live";
    const pct = e.totalFundedBase > 0 ? Math.round((e.paidBase / e.totalFundedBase) * 100) : 0;
    const activity = loadCampaignActivity(campaign.id);
    // P23 — the headline may promise "paid automatically" ONLY when this campaign actually autopays.
    const autopays = campaignAutopays(campaign, e.missions, e.isTestnet);
    // P23 — Sage's own exploration breadth (the differentiator), shown only when we recorded it.
    const explored = campaign.exploredScreens > 0
      ? { screens: campaign.exploredScreens, elements: campaign.exploredElements }
      : null;
    // the campaign is complete when every paid slot is filled, or it's no longer live.
    const complete = !live || (e.totalCompletions > 0 && e.paidCompletions >= e.totalCompletions);
    return (
      <main className="sb-shell">
        <header className="sb-top">
          <Link href="/" className="sb-brand" style={{ textDecoration: "none" }}>
            <SageMark size={20} /> Sage
          </Link>
          <span className="tb-top-net">
            <NetworkChip chainId={e.chainId} size="xs" />
            <span className="sb-net"><span className="dot" /> Reward campaign</span>
          </span>
        </header>

        <div className="sage-agent-card tb-hero">
          {/* THE ONE LINE A TESTER READS TO DECIDE WHETHER THIS IS SAFE TO WORK FOR. On the
              private rail "public receipt" is the wrong promise — the whole point is that a tester
              need not publish their income — so the claim names the choice instead. This copy came
              from the legacy board; moving Starknet onto this one must not quietly drop it. */}
          <div className="sage-eyebrow">
            <ShieldCheck size={13} />{" "}
            {campaign.vaultKind === "sage_vault_starknet"
              ? "Paid from a vault with hard spending limits — privately, if you choose"
              : "Paid from a founder-owned vault with hard on-chain limits"}
          </div>
          <h1 className="tb-hero-title">{boardHeadline(campaign).title}</h1>
          {/* a direct campaign's "description" is its own board URL (v2-setup stores productUrl there) —
              a bare link under the headline is noise, not a description */}
          {campaign.descriptionMd && !/^https?:\/\/\S+$/.test(campaign.descriptionMd.trim()) && (
            <p className="tb-hero-desc">{campaign.descriptionMd}</p>
          )}

          {explored && <ExploredBanner screens={explored.screens} elements={explored.elements} />}

          {complete && (
            <div className="tb-done">
              <Check size={16} strokeWidth={2.4} />
              <span>
                This campaign is <b>complete</b> — every reward has been paid. Thanks for the interest.
              </span>
            </div>
          )}

          <div className="v2-econ">
            <div className="v2-econ-row">
              <div className="v2-econ-fig"><span className="k">Funded</span><span className="v mono">{fmtRewardAligned(e.totalFundedBase, e.chainId)}</span></div>
              <div className="v2-econ-fig"><span className="k">Paid</span><span className="v mono">{fmtRewardAligned(e.paidBase, e.chainId)}</span></div>
              <div className="v2-econ-fig"><span className="k">Remaining</span><span className="v mono">{fmtRewardAligned(e.remainingBase, e.chainId)}</span></div>
            </div>
            <div className="v2-econ-bar"><span style={{ width: `${pct}%` }} /></div>
            <div className="v2-econ-meta">
              <span>{networkLabel(e.chainId)}</span>
              <span>·</span>
              <span>{e.missionCount} mission{e.missionCount === 1 ? "" : "s"}</span>
              <span>·</span>
              <span>{e.paidCompletions}/{e.totalCompletions} paid</span>
              <span>·</span>
              <span className={complete ? "tb-econ-status-done" : ""}>
                {complete ? "Completed" : live ? "Live" : "Closed"}
              </span>
            </div>
            {e.isTestnet && (
              <p className="v2-testnote">Payouts here are real on-chain testnet transactions. Test mUSDC has no monetary value.</p>
            )}
          </div>
        </div>

        {!complete && <HowYouGetPaid autopays={autopays} personhood={identityDoorArmed() && isPublicWork(campaign) && !!worldIdConfig()} />}

        <div className="sb-sec-label">Missions</div>
        <V2Board
          campaignId={campaign.id}
          campaignIdHash={campaign.campaignIdHash ?? `0x${"0".repeat(64)}`}
          chainId={e.chainId}
          live={live}
          missions={e.missions}
          autopays={autopays}
          rail={campaign.settlementRail === "starknet" ? "starknet" : "evm"}
        />

        <SageActivity campaignId={campaign.id} chainId={e.chainId} initial={activity} pending={activity.pending} complete={complete} />

        <TesterFaq perWalletCap={campaign.perWalletPayoutCap} />

        <nav className="tb-more">
          {/* A tester who finishes here (or finds this one full) has nowhere to go without this. */}
          <a href="/marketplace">Browse every open mission on Sage &rarr;</a>
        </nav>

        <footer className="sage-hint" style={{ padding: "24px 2px 60px" }}>
          {/* "A verifiable transaction you can inspect" is the wrong closing promise on the
              private rail: a tester may collect into a shielded note precisely so their income is
              not inspectable. The guarantee that still holds — bounded operator, on-chain limits —
              is stated either way; only the part about visibility changes. */}
          You own the campaign vault; Sage is the bounded operator. It reviews each submission
          and pays eligible work within your on-chain limits — it can never exceed the budget,
          the per-mission reward, or the completion caps.{" "}
          {campaign.vaultKind === "sage_vault_starknet"
            ? "Every payout is a real on-chain transaction; whether yours is traceable to you is your choice."
            : "Every payout is a verifiable transaction you can inspect on the block explorer."}
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

  // The ring reads the campaign's reward pool when the campaign is capped; otherwise the funding
  // vault's live balance.
  //
  // The `.catch()` below guards the PROMISE, and `getAddress` throws SYNCHRONOUSLY while building
  // the argument — so it never protected this call at all. A campaign settled on Starknet has a
  // felt where an EVM address is expected, and the throw took the whole public page down with a
  // 500. A campaign that pays people should not be unreachable because it has no vault to read.
  //
  // A Starknet campaign may or may not have a vault: the private-capable rail deploys a real
  // per-campaign Cairo vault the founder owns, while older direct-pay campaigns have none. Read
  // whichever exists, and never hand a felt to viem — `getAddress` throws SYNCHRONOUSLY while
  // building the argument, so the `.catch()` below never protected that call, and the throw took
  // the whole public page down with a 500. A campaign that pays people should not be unreachable.
  const vault = await (async () => {
    try {
      if (campaign.vaultKind === "sage_vault_starknet") {
        const s = await readStarknetVaultState(campaign.vaultAddress);
        const held = await readStarknetVaultBalance(campaign.vaultAddress);
        const ceiling = Number(s.budgetCeilingBase) / 1e6;
        return {
          budget: ceiling,
          // What can still be paid is the smaller of what the vault holds and what its ceiling
          // still allows — either one alone would overstate the money available to a tester.
          remaining: Math.max(0, Math.min(Number(held) / 1e6, ceiling - Number(s.totalSpentBase) / 1e6)),
        };
      }
      if (campaign.settlementRail === "starknet") return null;
      return await getVaultState(getAddress(campaign.vaultAddress));
    } catch {
      return null;
    }
  })();
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
          <ShieldCheck size={13} />{" "}
          {/* THE ONE LINE A TESTER READS TO DECIDE WHETHER THIS IS SAFE TO WORK FOR, so it must
              say only what is actually enforced for THIS campaign. A private-capable campaign has
              a real Cairo vault the founder owns and Sage cannot withdraw from; an older
              direct-pay Starknet campaign has none, and claiming limits nobody wrote would be a
              lie exactly where it matters most. Nor is "public receipt" right on the private
              rail — the whole point is that a tester need not publish their income. */}
          {campaign.settlementRail === "starknet"
            ? "Paid on-chain by Sage, every payout with a public receipt"
            : "Paid from an on-chain wallet with hard spending limits"}
        </div>
        {/* SAGE FOR TEAMS — this door is the only way here; say so, so the person a company
            invited understands why they will not find it on the board. */}
        {campaign.visibility === "unlisted" && (
          <p className="sb-invite-line">
            <b>Invite only.</b> This campaign is not on the public marketplace — you are here because
            someone shared its link with you. The work, the verification and the payout are the same.
          </p>
        )}
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
        rail={campaign.settlementRail}
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

      {/* The same claim as the header, and it has to survive the same test: say only what is
          enforced for THIS campaign. A direct-pay Starknet campaign has no vault at all, so
          naming one here would promise a protection nobody wrote — in the closing line a tester
          reads before deciding to work. */}
      <footer className="sage-hint" style={{ padding: "24px 2px 60px" }}>
        {campaign.settlementRail === "starknet" ? (
          <>
            Rewards are paid by Sage directly to the wallet you signed in with. Every payout is a
            verifiable transaction you can inspect on the block explorer.
          </>
        ) : (
          <>
            Rewards are paid by Sage from an on-chain wallet with hard spending limits (the Policy
            Vault). Every payout is a verifiable transaction you can inspect on the block explorer.
          </>
        )}
      </footer>
    </main>
  );
}
