import Link from "next/link";
import { ArrowUpRight, Building2, CheckCircle2, Inbox, Lock, Rocket, Settings, ShieldCheck, Users, X } from "lucide-react";
import { reward as fmtReward, networkLabel, short, since } from "@/lib/format";
import type { FounderDesk } from "@/lib/campaigns/founder-activity";
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

/**
 * THE OWNER'S HOME — one screen, three things: what to do next while the workspace is new, the
 * work that is open, and what Sage did last. People and the plan have their own pages.
 */
export function OwnerWorkspace({ view }: { view: OwnerView }) {
  const ws = view.workspace;
  const live = view.campaigns.filter((c) => c.status === "live");
  const invited = view.memberCount > 1;
  const posted = view.campaigns.length > 0;
  const paid = view.campaigns.some((c) => c.paid > 0);
  const fresh = !(invited && posted && paid);

  return (
    <main className="ws-shell">
      <div className="ws-head">
        <div>
          <div className="sage-eyebrow"><Building2 size={13} /> Workspace</div>
          <h1 className="ws-title">{ws.name}</h1>
          <p className="ws-sub">{view.memberCount} member{view.memberCount === 1 ? "" : "s"} · {live.length} open · {ws.plan === "pro" ? "Pro" : "Free plan"}</p>
        </div>
        <div className="ws-nav">
          <Link className="ws-chip" href="/workspace/people"><Users size={11} /> People</Link>
          <Link className="ws-chip" href="/workspace/settings"><Settings size={11} /> Settings</Link>
          <Link className="sage-btn sage-btn-primary sage-btn-sm" href="/launch?do=pay"><Rocket size={14} /> Post work</Link>
        </div>
      </div>

      {fresh && (
        <div className="ws-card">
          <div className="ws-card-h"><h2>Three steps to your first verified payout</h2></div>
          <ol className="ws-check">
            <li className={invited ? "done" : ""}>
              <span className="ws-check-n">{invited ? <CheckCircle2 size={12} /> : "1"}</span>
              <span className="ws-check-t">Invite your people</span>
              <span className="ws-check-s">A wallet link, or a Telegram link that gives them a wallet.</span>
              <Link href="/workspace/people">Invite →</Link>
            </li>
            <li className={posted ? "done" : ""}>
              <span className="ws-check-n">{posted ? <CheckCircle2 size={12} /> : "2"}</span>
              <span className="ws-check-t">Post the work</span>
              <span className="ws-check-s">A gig, a milestone grant or a testing run. Invite-only keeps it to members.</span>
              <Link href="/launch?do=pay">Post work →</Link>
            </li>
            <li className={paid ? "done" : ""}>
              <span className="ws-check-n">{paid ? <CheckCircle2 size={12} /> : "3"}</span>
              <span className="ws-check-t">Fund it once</span>
              <span className="ws-check-s">The vault holds the budget; Sage verifies and pays inside it, receipt by receipt.</span>
              {posted ? <Link href="/dashboard">See the vault →</Link> : <span />}
            </li>
          </ol>
        </div>
      )}

      <div className="ws-card">
        <div className="ws-card-h"><h2>Open work</h2><Link className="ws-chip" href="/dashboard">all work <ArrowUpRight size={11} /></Link></div>
        {live.length === 0 ? (
          <p className="ws-empty">Nothing open right now. <Link href="/launch?do=pay">Post work</Link> and your members hear about it the moment it is live.</p>
        ) : (
          <ul className="ws-list">
            {live.map((c) => (
              <li key={c.id} className="ws-row">
                <div className="ws-row-main">
                  <p className="ws-row-title"><Link href={`/campaign/${c.id}`}>{c.title}</Link></p>
                  <p className="ws-row-meta">{fmtReward(c.rewardBase, chainFor(c.rail))} each · {c.paid}/{c.slots} paid{c.pending ? ` · ${c.pending} in review` : ""} · {networkLabel(chainFor(c.rail))}{c.visibility === "unlisted" ? " · members only" : " · open"}</p>
                </div>
                <Link className="ws-chip" href={`/c/${c.id}`}>board</Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {view.desk.events.length > 0 && (
        <div className="ws-card">
          <div className="ws-card-h"><h2>Sage, lately</h2></div>
          <ul className="ws-list">
            {view.desk.events.slice(0, 5).map((a) => (
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
        </div>
      )}
    </main>
  );
}
