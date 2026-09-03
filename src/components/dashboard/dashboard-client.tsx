"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Rocket, Sparkles, ArrowRight, ArrowUpRight, CheckCircle2, Clock, HandCoins, Inbox, ShieldCheck, XCircle, Check, CircleDot, Square } from "lucide-react";
import type { FounderDesk } from "@/lib/campaigns/founder-activity";
import { reward as fmtReward } from "@/lib/format";
import "@/styles/tester-board.css";
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

/** relative "worked Xm ago" — client-only (rendered behind the `live` mount guard). */
function agoShort(fromSec: number): string {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - fromSec);
  if (d < 60) return "worked just now";
  if (d < 3600) return `worked ${Math.max(1, Math.round(d / 60))}m ago`;
  if (d < 86400) return `worked ${Math.round(d / 3600)}h ago`;
  return `worked ${Math.round(d / 86400)}d ago`;
}

const GROUP_ORDER: { key: Group; label: string; Icon: typeof CircleDot }[] = [
  { key: "running", label: "Running", Icon: CircleDot },
  { key: "stopped", label: "Stopped", Icon: Square },
  { key: "done", label: "Completed", Icon: Check },
];

export function DashboardClient({
  desk: initialDesk,
  signedIn,
  address,
  campaigns,
  paidAmountBase,
  approvedRecipients,
  totalPaid,
}: {
  desk: FounderDesk;
  // (prop is the server seed; live state below owns the rendered value)
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

  /**
   * THE DESK, LIVE — the same watch-don't-chat discipline the campaign console already has,
   * on the founder's home. Server-seeded, then polled at a calm workplace cadence (this is a
   * desk, not a ticker); hidden tabs poll nothing; every row is a real ledger event via the
   * one safe projection. A founder who leaves this page open sees Sage receive, verify and
   * pay without ever reloading — which is the product doing its own demo.
   */
  const [desk, setDesk] = useState<FounderDesk>(initialDesk);
  const deskSig = useRef(`${initialDesk.lastWorkedAt ?? 0}:${initialDesk.events.map((e) => e.id).join(",")}`);
  useEffect(() => {
    if (!signedIn) return;
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch("/api/founder/desk", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { desk?: FounderDesk };
        const next = j.desk ?? { events: [], lastWorkedAt: null };
        const s = `${next.lastWorkedAt ?? 0}:${next.events.map((e) => e.id).join(",")}`;
        if (s === deskSig.current) return;
        deskSig.current = s;
        setDesk(next);
      } catch {
        /* transient — the next tick retries */
      }
    };
    const timer = setInterval(() => void tick(), 15000);
    const onVis = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [signedIn]);

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
          <div className="sage-eyebrow dash-eyebrow">Work</div>
        {/* A greeting, not a hex dump. The address is identity plumbing — real products greet
            the person and keep the key in the small print. */}
        <h1 className="sb-welcome-h1 dash-display">Your money at work.</h1>
        <p className="sb-welcome-sub">
          Everything you have posted, and what Sage did with it — verified, paid or held, receipt by
          receipt, from a vault it can never exceed.
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
            <span className="sb-dash-stat-k">People paid</span>
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
          <span className="sb-home-card-title dash-h3">Post work</span>
          <span className="sb-home-card-desc">
            A gig, a milestone grant — say it once. Sage verifies the deliverable itself and
            releases each payment only on proof. Members-only when you choose.
          </span>
          <span className="sb-home-card-cta">
            Start <ArrowRight size={14} strokeWidth={2.2} />
          </span>
        </Link>
      </div>

      {/* THE DESK — what the agent did lately, across everything you own. The workplace's own
          register: the same safe activity vocabulary as every campaign board (projection built in
          one place, an aggregation of safe rows is safe), each line naming its campaign. Rendered
          only when work exists — an empty promise box would be marketing. */}
      {desk.events.length > 0 && (
        <section className="sb-cat sb-desk" aria-label="Sage at work">
          <div className="sb-cat-label">
            <Sparkles size={13} strokeWidth={2.2} className="sb-cat-ico" />
            Sage at work
            {live && desk.lastWorkedAt != null && (
              <span className="sb-desk-beat">{agoShort(desk.lastWorkedAt)}</span>
            )}
          </div>
          <div className="tb-act-list sb-desk-list">
            {desk.events.map((a) => {
              const tone = a.kind === "paid" ? "pos" : a.kind === "verified" ? "accent" : a.kind === "held" ? "warn" : a.kind === "blocked" ? "dan" : "";
              return (
                <div key={`${a.campaignId}:${a.id}`} className={`tb-act-row${tone ? ` ${tone}` : ""}`}>
                  <span className="tb-act-ico">
                    {a.kind === "received" ? <Inbox size={14} /> : a.kind === "verified" ? <ShieldCheck size={14} /> : a.kind === "paid" ? <CheckCircle2 size={14} /> : a.kind === "held" ? <Clock size={14} /> : <XCircle size={14} />}
                  </span>
                  <span className="tb-act-text">
                    {a.kind === "received" && "New submission received"}
                    {a.kind === "verified" && (a.confidencePct != null ? `Evidence verified · ${a.confidencePct}% confidence` : "Evidence verified")}
                    {a.kind === "paid" && (
                      <>
                        Paid <b className="mono">{a.amountBase != null ? fmtReward(a.amountBase, 2345) : "reward"}</b>
                        {a.wallet ? <> to <span className="mono">{short(a.wallet)}</span></> : null}
                      </>
                    )}
                    {a.kind === "held" && (a.reasonClass ? `Held: ${a.reasonClass}` : "Held for review")}
                    {a.kind === "blocked" && `Blocked · ${a.reasonClass ?? "integrity check"}`}
                  </span>
                  {a.kind === "paid" && a.txHash ? (
                    <a className="tb-act-proof" href={`/proof/${a.txHash}`}>
                      <ArrowUpRight size={12} /> proof
                    </a>
                  ) : null}
                  <button className="sb-desk-camp" onClick={() => router.push(`/campaign/${a.campaignId}`)}>
                    {a.campaignTitle}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {campaigns.length === 0 ? (
        <div className="sage-agent-card sb-dash-empty">
          <p className="sage-hint sb-dash-empty-p">
            No campaigns yet — launch one above and Sage will design the missions.
          </p>
          {/* ONBOARDING — a new founder should see the thing working before funding anything:
              the public ledger and a live board are one click away. */}
          <p className="sage-hint sb-dash-empty-p">
            Want to see it working first? Open the{" "}
            <Link href="/explorer">public ledger</Link> or{" "}
            <Link href="/marketplace">a live board</Link> — every payout there is a real transaction.
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
                          {c.visibility === "unlisted" && (
                            <>
                              <span className="sb-dot" aria-hidden>·</span>
                              <span className="sb-invite-chip">invite only</span>
                            </>
                          )}
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
