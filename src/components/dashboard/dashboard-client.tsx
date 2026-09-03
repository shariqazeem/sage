"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Blocks, Check, CircleDot, FlaskConical, Inbox, Rocket, Sparkles, Square } from "lucide-react";
import type { FounderDesk } from "@/lib/campaigns/founder-activity";
import { usd as fmtUsd } from "@/lib/format";
import "@/styles/tester-board.css";
import "@/styles/wallet-connect.css";
import "@/styles/workspace.css";
import { FounderSignIn } from "@/components/wallet/founder-sign-in";
import { chainConfig } from "@/lib/deputy/networks";
import type { CampaignCard } from "@/lib/campaigns/overview";
import { SageAtWork } from "@/components/workspace/sage-at-work";

function CampaignMark({ title }: { title: string }) {
  const letter = (title.trim()[0] ?? "?").toUpperCase();
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className="ws-mark" style={{ background: `hsl(${h} 42% 94%)`, color: `hsl(${h} 55% 32%)` }}>
      {letter}
    </span>
  );
}

function short(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

type Group = "running" | "stopped" | "done";
function statusMeta(c: CampaignCard): { group: Group; label: string } {
  const s = c.status.toLowerCase();
  if (s === "cancelled" || s === "stopped") return { group: "stopped", label: "Stopped" };
  if (s === "completed" || s === "closed") return { group: "done", label: "Completed" };
  if (c.totalCompletions > 0 && c.paid >= c.totalCompletions) return { group: "done", label: "Completed" };
  if (s === "paused") return { group: "running", label: "Paused" };
  if (s === "draft") return { group: "running", label: "Draft" };
  return { group: "running", label: "Live" };
}

const GROUP_ORDER: { key: Group; label: string; Icon: typeof CircleDot }[] = [
  { key: "running", label: "Running", Icon: CircleDot },
  { key: "done", label: "Completed", Icon: Check },
  { key: "stopped", label: "Stopped", Icon: Square },
];

/**
 * WORK — everything this founder has posted, and what Sage did with it. Same system as the
 * workspace home: a header, four numbers that are rows, two doors, the agent's timeline (polled,
 * so a payout appears without a reload), then the campaigns grouped by what they are doing now.
 */
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
  signedIn: boolean;
  address: string | null;
  campaigns: CampaignCard[];
  paidAmountBase: number;
  approvedRecipients: number;
  totalPaid: number;
}) {
  const router = useRouter();
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
        /* a blip; the next tick reads again */
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
      <main className="st-shell">
        <div className="st-card">
          <span className="ws-eyebrow">Work</span>
          <h1 className="st-h1" style={{ marginTop: 8 }}>Sign in to see your work</h1>
          <p className="st-p">Every campaign you own, what Sage has paid, and each console — behind the wallet you launched from.</p>
          <FounderSignIn explainer={<>Sign in with the wallet you launched from — <b>Ethereum or Starknet.</b></>} onSignedIn={() => router.refresh()} />
        </div>
      </main>
    );
  }

  const grouped = GROUP_ORDER.map((g) => ({ ...g, items: campaigns.filter((c) => statusMeta(c).group === g.key) })).filter((g) => g.items.length > 0);
  const running = campaigns.filter((c) => statusMeta(c).group === "running").length;

  return (
    <main className="ws-shell ws-stagger">
      <header className="ws-head">
        <div>
          <span className="ws-eyebrow">Work</span>
          <h1 className="ws-title">Your money at work</h1>
          <p className="ws-sub">
            Everything you have posted, and what Sage did with it — verified, paid or held, receipt by receipt, from a vault it can never exceed.
            {address && <> Signed in as <span className="mono">{short(address)}</span>.</>}
          </p>
        </div>
        <div className="ws-nav">
          <Link className="ws-chip" href="/workspace"><Blocks size={12} /> Workspace</Link>
          <Link className="sage-btn sage-btn-primary sage-btn-sm" href="/launch?do=pay"><Rocket size={14} /> Post work</Link>
        </div>
      </header>

      <section className="ws-stats" aria-label="At a glance">
        <div className="ws-stat"><span className="ws-stat-v">{campaigns.length}</span><span className="ws-stat-k">Campaigns · {running} running</span></div>
        <div className={`ws-stat${paidAmountBase > 0 ? " pos" : ""}`}><span className="ws-stat-v">{fmtUsd(paidAmountBase / 1e6)}</span><span className="ws-stat-k">Released</span></div>
        <div className="ws-stat"><span className="ws-stat-v">{totalPaid}</span><span className="ws-stat-k">Payouts</span></div>
        <div className="ws-stat"><span className="ws-stat-v">{approvedRecipients}</span><span className="ws-stat-k">People paid</span></div>
      </section>

      <ol className="ws-check two" style={{ marginBottom: 18 }}>
        <li className="door">
          <span className="ws-door-ic"><Rocket size={17} /></span>
          <span className="ws-check-t">Post work</span>
          <span className="ws-check-s">A gig or a milestone grant — say it once. Sage verifies the deliverable itself and releases each payment only on proof. Members-only when you choose.</span>
          <Link href="/launch?do=pay">Start →</Link>
        </li>
        <li className="door">
          <span className="ws-door-ic"><FlaskConical size={17} /></span>
          <span className="ws-check-t">Test my product</span>
          <span className="ws-check-s">Give Sage a URL and a budget — it explores the product itself, designs missions, and pays verified testers on-chain.</span>
          <Link href="/launch">Start →</Link>
        </li>
      </ol>

      {desk.events.length > 0 && (
        <section className="ws-card">
          <div className="ws-card-h"><h2><Sparkles size={15} /> Sage at work</h2><span className="ws-tl-live">live</span></div>
          <SageAtWork desk={desk} limit={8} />
        </section>
      )}

      {campaigns.length === 0 ? (
        <p className="ws-empty" style={{ marginTop: 18 }}>
          <Inbox size={18} />
          <span>
            No campaigns yet — post work above and Sage designs or compiles the missions. Want to see it working first? Open the <Link href="/explorer">public ledger</Link> or <Link href="/marketplace">a live board</Link> — every payout there is a real transaction.
          </span>
        </p>
      ) : (
        grouped.map((g) => (
          <section key={g.key} className="ws-group">
            <p className={`ws-group-h ${g.key}`}><g.Icon size={12} /> {g.label} <span className="n">{g.items.length}</span></p>
            <div className="ws-card" style={{ padding: "6px 22px" }}>
              <ul className="ws-list">
                {g.items.map((c) => {
                  const meta = statusMeta(c);
                  return (
                    <li key={c.id} className="ws-row" style={{ padding: 0 }}>
                      <Link href={`/campaign/${c.id}`} className="ws-rowlink" style={{ flex: 1 }}>
                        <div className="ws-member">
                          <CampaignMark title={c.title} />
                          <div className="ws-row-main">
                            <p className="ws-row-title"><span className="t">{c.title}</span></p>
                            <p className="ws-row-meta">
                              {chainConfig(c.chainId).chipLabel} · {fmtUsd(c.rewardBase / 1e6)} per mission · <b>{c.paid}</b> paid
                              {g.key === "running" && c.pending > 0 ? <> · <b>{c.pending}</b> in review</> : null}
                              {" · "}{c.submissions} submission{c.submissions === 1 ? "" : "s"}
                              {c.visibility === "unlisted" ? " · members only" : ""}
                              {g.key === "stopped" ? " · funds returned" : ""}
                            </p>
                          </div>
                        </div>
                        <div className="ws-row-side">
                          <span className={`ws-chip${meta.label === "Live" ? " live" : g.key === "done" ? " paid" : ""}`}>{meta.label.toLowerCase()}</span>
                          <span className="ws-chip">console <ArrowUpRight size={11} /></span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        ))
      )}
    </main>
  );
}
