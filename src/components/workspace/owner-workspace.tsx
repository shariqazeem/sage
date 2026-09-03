"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Building2, CheckCircle2, Copy, Inbox, Link2, Loader2, Lock, Rocket, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import { reward as fmtReward, networkLabel, short, since } from "@/lib/format";
import type { FounderDesk } from "@/lib/campaigns/founder-activity";
import { ProPay } from "./pro-pay";
import type { SettlementRail, WorkspacePlan, WorkspaceRole } from "@/lib/db/schema";

export interface OwnerView {
  workspace: { id: string; name: string; slug: string; plan: WorkspacePlan; planUntil: number | null; memberCap: number; proPriceUsd: number };
  members: { key: string; address: string | null; role: WorkspaceRole; displayName: string | null; joinedAt: number; viaTelegram: boolean }[];
  memberCount: number;
  campaigns: {
    id: string;
    title: string;
    kind: "testing" | "grant" | "gig";
    status: string;
    visibility: "listed" | "unlisted";
    rail: SettlementRail;
    rewardBase: number;
    paid: number;
    pending: number;
    slots: number;
  }[];
  desk: FounderDesk;
  me: string;
}

const chainFor = (rail: SettlementRail) => (rail === "starknet" ? 900001 : 2345);
const initials = (m: OwnerView["members"][number]) => (m.displayName?.trim()[0] ?? (m.viaTelegram ? "T" : (m.address ?? m.key).replace(/^0x0*/, "")[0] ?? "?")).toUpperCase();

/**
 * THE OWNER'S WORKSPACE. Everything the team is doing, on one screen, composed from the same rows
 * the console and the boards read: open work with paid/pending counts, members with the invite
 * link, the plan and what it unlocks, and Sage's recent work across the workspace.
 */
export function OwnerWorkspace({ view }: { view: OwnerView }) {
  const router = useRouter();
  const ws = view.workspace;
  const [invite, setInvite] = useState<{ url: string; telegram: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const full = view.memberCount >= ws.memberCap;

  const mintInvite = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/workspaces/invites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: ws.id }) });
      const json = (await res.json()) as { error?: string; url?: string; telegram?: string };
      if (!res.ok || !json.url || !json.telegram) {
        setErr(json.error ?? "Could not create an invite.");
        return;
      }
      setInvite({ url: json.url, telegram: json.telegram });
    } catch {
      setErr("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      /* clipboard unavailable — the text is visible to select */
    }
  };

  const remove = async (memberKey: string) => {
    if (!confirm("Remove this member from the workspace?")) return;
    const res = await fetch("/api/workspaces/members", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: ws.id, memberKey }) });
    if (res.ok) router.refresh();
  };

  return (
    <main className="ws-shell">
      <div className="ws-head">
        <div>
          <div className="sage-eyebrow"><Building2 size={13} /> Workspace</div>
          <h1 className="ws-title">{ws.name}</h1>
          <p className="ws-sub">
            {view.memberCount} member{view.memberCount === 1 ? "" : "s"} · {view.campaigns.filter((c) => c.status === "live").length} open · Sage verifies the work and pays inside the budget you fund.
          </p>
        </div>
        <div className="ws-row-side">
          <span className={`ws-plan${ws.plan === "pro" ? " pro" : ""}`}>{ws.plan === "pro" ? <><Sparkles size={12} /> Pro</> : <>Free plan</>}</span>
          <Link className="sage-btn sage-btn-primary sage-btn-sm" href="/launch?mode=pay"><Rocket size={14} /> Post work</Link>
        </div>
      </div>

      <div className="ws-grid">
        <div>
          <div className="ws-card">
            <div className="ws-card-h"><h2>Work</h2><Link className="ws-chip" href="/dashboard">console <ArrowUpRight size={11} /></Link></div>
            {view.campaigns.length === 0 ? (
              <p className="ws-empty">No work posted yet. <Link href="/launch?mode=pay">Post the first piece</Link> — a gig, a milestone grant, or a testing run. Unlisted work is for your members only; listed work is open to anyone.</p>
            ) : (
              <ul className="ws-list">
                {view.campaigns.map((c) => (
                  <li key={c.id} className="ws-row">
                    <div className="ws-row-main">
                      <p className="ws-row-title"><Link href={`/campaign/${c.id}`}>{c.title}</Link></p>
                      <p className="ws-row-meta">
                        {c.kind} · {fmtReward(c.rewardBase, chainFor(c.rail))} each · {c.paid}/{c.slots} paid{c.pending ? ` · ${c.pending} in review` : ""} · {networkLabel(chainFor(c.rail))}
                        {c.visibility === "unlisted" ? " · members only" : " · open"}
                      </p>
                    </div>
                    <div className="ws-row-side">
                      <span className={`ws-chip${c.status === "live" ? " live" : ""}`}>{c.status}</span>
                      <Link className="ws-chip" href={`/c/${c.id}`}>board</Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="ws-card">
            <div className="ws-card-h"><h2>Sage&rsquo;s recent work</h2></div>
            {view.desk.events.length === 0 ? (
              <p className="ws-empty">Nothing yet. Once work is posted, every verification, payout and hold shows here with its receipt.</p>
            ) : (
              <ul className="ws-list">
                {view.desk.events.map((a) => (
                  <li key={`${a.campaignId}:${a.id}`} className="ws-row">
                    <div className="ws-row-main">
                      <p className="ws-row-title">
                        {a.kind === "received" && <><Inbox size={13} /> New submission</>}
                        {a.kind === "verified" && <><ShieldCheck size={13} /> Verified{a.confidencePct != null ? ` · ${a.confidencePct}%` : ""}</>}
                        {a.kind === "paid" && <><CheckCircle2 size={13} /> Paid {a.amountBase != null ? fmtReward(a.amountBase, 2345) : ""}{a.wallet ? ` to ${short(a.wallet)}` : ""}</>}
                        {a.kind === "held" && <><Lock size={13} /> Held{a.reasonClass ? `: ${a.reasonClass}` : ""}</>}
                        {a.kind === "blocked" && <><X size={13} /> Blocked</>}
                      </p>
                      <p className="ws-row-meta">{a.campaignTitle} · {since(a.at)}</p>
                    </div>
                    {a.kind === "paid" && a.txHash && <a className="ws-chip" href={`/proof/${a.txHash}`}>receipt</a>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div>
          <div className="ws-card">
            <div className="ws-card-h"><h2><Users size={14} /> Members</h2><span className="ws-chip">{view.memberCount}{Number.isFinite(ws.memberCap) ? ` / ${ws.memberCap}` : ""}</span></div>
            <ul className="ws-list">
              {view.members.map((m) => (
                <li key={m.key} className="ws-row">
                  <div className="ws-member">
                    <span className="ws-avatar">{initials(m)}</span>
                    <div className="ws-row-main">
                      <p className="ws-row-title">{m.displayName ?? (m.address ? short(m.address) : m.key)}</p>
                      <p className="ws-row-meta">{m.role}{m.viaTelegram ? " · via Telegram" : ""} · joined {since(m.joinedAt)}</p>
                    </div>
                  </div>
                  {m.role !== "owner" && m.key !== view.me && (
                    <button className="ws-chip" onClick={() => void remove(m.key)} aria-label="Remove member"><X size={11} /></button>
                  )}
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 12 }}>
              {invite ? (
                <>
                  <div className="ws-invite">
                    <code>{invite.url}</code>
                    <button className="sage-btn sage-btn-sm" onClick={() => void copy(invite.url, "web")}>{copied === "web" ? "Copied" : <><Copy size={13} /> Copy</>}</button>
                  </div>
                  <div className="ws-invite">
                    <code>{invite.telegram}</code>
                    <button className="sage-btn sage-btn-sm" onClick={() => void copy(invite.telegram, "tg")}>{copied === "tg" ? "Copied" : <><Copy size={13} /> Copy</>}</button>
                  </div>
                  <p className="sage-hint" style={{ marginTop: 8 }}>The first link joins with a wallet. The second opens Telegram, where Sage sets up a wallet for them — no app, no seed phrase.</p>
                </>
              ) : (
                <button className="sage-btn sage-btn-sm sage-btn-primary" onClick={() => void mintInvite()} disabled={busy}>
                  {busy ? <><Loader2 size={14} className="sage-spin2" /> Creating…</> : full ? <><Lock size={14} /> Invite (upgrade needed)</> : <><Link2 size={14} /> Invite people</>}
                </button>
              )}
              {err && <p className="ws-err">{err}</p>}
            </div>
          </div>

          <div className="ws-card">
            <div className="ws-card-h"><h2>Plan</h2></div>
            <div className="ws-tiers">
              <div className={`ws-tier${ws.plan === "free" ? " on" : ""}`}>
                <h3>Free</h3>
                <p className="price">$0</p>
                <ul>
                  <li>You + 2 members</li>
                  <li>Gigs, grants, testing runs</li>
                  <li>Public receipts on GOAT</li>
                </ul>
              </div>
              <div className={`ws-tier${ws.plan === "pro" ? " on" : ""}`}>
                <h3>Pro</h3>
                <p className="price">${ws.proPriceUsd}<span style={{ fontSize: 12, fontWeight: 500, color: "var(--sec)" }}>/month</span></p>
                <ul>
                  <li>Unlimited members</li>
                  <li>Private payouts on Starknet</li>
                  <li>Working-capital advances for members</li>
                </ul>
              </div>
            </div>
            {ws.plan === "pro" && ws.planUntil ? (
              <p className="sage-hint" style={{ marginTop: 10 }}>Pro until {new Date(ws.planUntil * 1000).toISOString().slice(0, 10)}. Pay again any time to extend.</p>
            ) : null}
            <ProPay workspaceId={ws.id} priceUsd={ws.proPriceUsd} />
          </div>
        </div>
      </div>
    </main>
  );
}
