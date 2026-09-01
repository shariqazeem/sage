"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Rocket, Sparkles, ArrowRight, Check, CircleDot, Square, Compass, HandCoins } from "lucide-react";
import { FounderSignIn } from "@/components/wallet/founder-sign-in";
import { useFounderSession } from "@/lib/auth/use-founder-session";
import "@/styles/wallet-connect.css";
import { chainConfig } from "@/lib/deputy/networks";
import { CountUp } from "@/components/app/count-up";
import type { CampaignCard } from "@/lib/campaigns/overview";

/** A letter mark from the campaign's own title, hued deterministically — same visual language as
 *  the marketplace board so the two surfaces read as one product. */
function CampaignMark({ title }: { title: string }) {
  const letter = (title.trim()[0] ?? "?").toUpperCase();
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className="sb-row-mark" style={{ background: `hsl(${h} 42% 94%)`, color: `hsl(${h} 55% 32%)` }}>
      {letter}
    </span>
  );
}

function short(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
function usd(base: number): string {
  return `$${(base / 1e6).toFixed(2)}`;
}

type Group = "running" | "stopped" | "done";
function statusMeta(c: CampaignCard): { group: Group; label: string } {
  const s = c.status.toLowerCase();
  if (s === "cancelled" || s === "stopped") return { group: "stopped", label: "Stopped" };
  if (s === "completed" || s === "closed") return { group: "done", label: "Completed" };
  // Economically done: every mission slot paid → no work or budget left. Show as Completed.
  if (c.totalCompletions > 0 && c.paid >= c.totalCompletions) return { group: "done", label: "Completed" };
  if (s === "paused") return { group: "running", label: "Paused" };
  if (s === "draft") return { group: "running", label: "Draft" };
  return { group: "running", label: "Live" };
}

const GROUP_ORDER: { key: Group; label: string; Icon: typeof CircleDot }[] = [
  { key: "running", label: "Running", Icon: CircleDot },
  { key: "stopped", label: "Stopped", Icon: Square },
  { key: "done", label: "Completed", Icon: Check },
];

export function DashboardClient({
  signedIn,
  address,
  campaigns,
  paidAmountBase,
  approvedRecipients,
  totalPaid,
}: {
  signedIn: boolean;
  address: string | null;
  campaigns: CampaignCard[];
  paidAmountBase: number;
  approvedRecipients: number;
  totalPaid: number;
}) {
  const router = useRouter();
  const founder = useFounderSession();
  const [live, setLive] = useState(false);
  useEffect(() => setLive(true), []);

  if (!signedIn) {
    return (
      <main className="sb-shell">
        <div className="sage-agent-card sb-dash-gate">
          <div className="sage-eyebrow">Your campaigns</div>
          <h1 className="sb-dash-h1 dash-display">Connect to see your campaigns</h1>
          <p className="sage-hint sb-dash-gate-p">
            Sign in with the wallet you launched from. You&apos;ll see every campaign you own, what
            Sage has paid, and can open each console.
          </p>
          {/* Any wallet, either family. This screen used to run `siwe.signIn()` straight into
              MetaMask, so a founder holding only Ready met a button that could not work for them. */}
          <FounderSignIn
            explainer={
              <>
                Sign in with the wallet you launched from — <b>Ethereum or Starknet.</b>
              </>
            }
            onSignedIn={() => router.refresh()}
          />
        </div>
      </main>
    );
  }

  const grouped = GROUP_ORDER.map((g) => ({
    ...g,
    items: campaigns.filter((c) => statusMeta(c).group === g.key),
  })).filter((g) => g.items.length > 0);

  return (
    <main className="sb-board sb-dash">
      <div className="sb-welcome">
        <div>
          <div className="sage-eyebrow dash-eyebrow">Founder dashboard</div>
        {/* A greeting, not a hex dump. The address is identity plumbing — real products greet
            the person and keep the key in the small print. */}
        <h1 className="sb-welcome-h1 dash-display">Your money at work.</h1>
        <p className="sb-welcome-sub">
          Test a product, pay for a deliverable, or fund milestones — Sage verifies every claim
          itself and settles from a vault it can never exceed.
          {address && (
            <span className="sb-welcome-wallet mono"> {short(address)}</span>
          )}
        </p>
        </div>
        <div className="sb-dash-stats">
          <div className="sb-dash-stat">
            <CountUp className="sb-dash-stat-v" value={live ? campaigns.length : 0} />
            <span className="sb-dash-stat-k">Campaigns</span>
          </div>
          <div className="sb-dash-stat">
            <CountUp className="sb-dash-stat-v" value={live ? paidAmountBase : 0} format={usd} />
            <span className="sb-dash-stat-k">Released</span>
          </div>
          <div className="sb-dash-stat">
            <CountUp className="sb-dash-stat-v" value={live ? totalPaid : 0} />
            <span className="sb-dash-stat-k">Payouts</span>
          </div>
          <div className="sb-dash-stat">
            <CountUp className="sb-dash-stat-v" value={live ? approvedRecipients : 0} />
            <span className="sb-dash-stat-k">Testers</span>
          </div>
        </div>
      </div>

      <div className="sb-home-cards sage-stagger">
        <Link href="/launch" className="sage-agent-card sb-agent-tap sb-home-card">
          <span className="sb-home-card-ico">
            <Rocket size={20} strokeWidth={1.9} />
          </span>
          <span className="sb-home-card-title dash-h3">Test my product</span>
          <span className="sb-home-card-desc">
            Give Sage a URL and a budget — it explores the product itself, designs missions, and
            pays verified testers on-chain.
          </span>
          <span className="sb-home-card-cta">
            Start <ArrowRight size={14} strokeWidth={2.2} />
          </span>
        </Link>
        <Link href="/launch?do=pay" className="sage-agent-card sb-agent-tap sb-home-card">
          <span className="sb-home-card-ico">
            <HandCoins size={20} strokeWidth={1.9} />
          </span>
          <span className="sb-home-card-title dash-h3">Pay for work</span>
          <span className="sb-home-card-desc">
            A gig, a bounty, a milestone grant — say it once. Sage verifies the deliverable itself
            and releases each payment only on proof.
          </span>
          <span className="sb-home-card-cta">
            Start <ArrowRight size={14} strokeWidth={2.2} />
          </span>
        </Link>
        <Link href="/marketplace" className="sage-agent-card sb-agent-tap sb-home-card">
          <span className="sb-home-card-ico">
            <Compass size={20} strokeWidth={1.9} />
          </span>
          <span className="sb-home-card-title dash-h3">Browse the marketplace</span>
          <span className="sb-home-card-desc">
            Every mission open across Sage right now — see what other founders are paying for, or do
            one yourself and get paid in USDC.
          </span>
          <span className="sb-home-card-cta">
            Browse <ArrowRight size={14} strokeWidth={2.2} />
          </span>
        </Link>
        <Link href="/agent" className="sage-agent-card sb-agent-tap sb-home-card">
          <span className="sb-home-card-ico">
            <Sparkles size={20} strokeWidth={1.9} />
          </span>
          <span className="sb-home-card-title dash-h3">Talk to Sage</span>
          <span className="sb-home-card-desc">
            Ask Sage to inspect a product, plan missions, or check any campaign or payout — in plain
            language.
          </span>
          <span className="sb-home-card-cta">
            Open chat <ArrowRight size={14} strokeWidth={2.2} />
          </span>
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <div className="sage-agent-card sb-dash-empty">
          <p className="sage-hint sb-dash-empty-p">
            No campaigns yet — launch one above and Sage will design the missions.
          </p>
        </div>
      ) : (
        grouped.map((g) => (
          <section key={g.key} className="sb-cat">
            <div className="sb-cat-label">
              <g.Icon size={13} strokeWidth={2.2} className={`sb-cat-ico sb-cat-ico-${g.key}`} />
              {g.label}
              <span className="sb-cat-count mono">{g.items.length}</span>
            </div>
            <ul className="sb-rows">
              {g.items.map((c) => {
                const meta = statusMeta(c);
                return (
                  <li key={c.id}>
                    <Link href={`/campaign/${c.id}`} className="sb-row">
                      <CampaignMark title={c.title} />
                      <span className="sb-row-main">
                        <span className="sb-row-title">{c.title}</span>
                        <span className="sb-row-meta">
                          <span>{chainConfig(c.chainId).chipLabel}</span>
                          <span className="sb-dot" aria-hidden>·</span>
                          <span>{usd(c.rewardBase)} / mission</span>
                          <span className="sb-dot" aria-hidden>·</span>
                          <span>
                            <b>{c.paid}</b> paid
                          </span>
                          {g.key === "running" && c.pending > 0 && (
                            <>
                              <span className="sb-dot" aria-hidden>·</span>
                              <span>
                                <b>{c.pending}</b> pending
                              </span>
                            </>
                          )}
                          <span className="sb-dot" aria-hidden>·</span>
                          <span>
                            <b>{c.submissions}</b> submissions
                          </span>
                          {g.key === "stopped" && (
                            <>
                              <span className="sb-dot" aria-hidden>·</span>
                              <span>funds returned</span>
                            </>
                          )}
                        </span>
                      </span>
                      <span className={`sb-stpill sb-stpill-${g.key} mono`}>{meta.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      <div className="sb-dash-foot">
        <button className="sage-foot-muted" onClick={() => void founder.signOut().then(() => router.refresh())}>
          Sign out
        </button>
      </div>
    </main>
  );
}
