import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Inbox, Rocket, Settings, Sparkles, Users } from "lucide-react";
import { reward as fmtReward, networkLabel, usd } from "@/lib/format";
import type { FounderDesk } from "@/lib/campaigns/founder-activity";
import type { SettlementRail, WorkspacePlan, WorkspaceRole } from "@/lib/db/schema";
import { SageAtWork } from "./sage-at-work";
import { SettlingLane } from "@/components/live/settling-lane";
import { NextMove } from "@/components/live/next-move";

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
    paidBase: number;
  }[];
  desk: FounderDesk;
  me: string;
}

const chainFor = (rail: SettlementRail) => (rail === "starknet" ? 900001 : 2345);
const KIND = { testing: "Testing run", grant: "Milestone grant", gig: "Gig" } as const;

/**
 * THE OWNER'S HOME. Four numbers, then — while the workspace is new — the three moves that make
 * the first verified payout happen; then the work that is open and the agent's own timeline.
 * People and the plan have their own pages. Nothing here is decoration: every number is a row.
 */
export function OwnerWorkspace({ view }: { view: OwnerView }) {
  const ws = view.workspace;
  const live = view.campaigns.filter((c) => c.status === "live");
  const paidCount = view.campaigns.reduce((n, c) => n + c.paid, 0);
  const paidUsd = view.campaigns.reduce((n, c) => n + c.paidBase, 0) / 1e6;
  const inReview = view.campaigns.reduce((n, c) => n + c.pending, 0);
  const invited = view.memberCount > 1;
  const posted = view.campaigns.length > 0;
  const paid = paidCount > 0;
  const fresh = !(invited && posted && paid);

  return (
    <main className="ws-shell ws-stagger">
      <header className="ws-head">
        <div>
          <span className="ws-eyebrow">Workspace</span>
          <h1 className="ws-title">{ws.name}</h1>
          <p className="ws-sub">Sage inspects, verifies and pays your people&rsquo;s work from the budget you fund — every payout a receipt, every refusal a reason, no one at your organization in the loop.</p>
        </div>
        <div className="ws-nav">
          <Link className="ws-chip" href="/workspace/people"><Users size={12} /> People</Link>
          <Link className="ws-chip" href="/workspace/settings"><Settings size={12} /> Settings</Link>
          <Link className="sage-btn sage-btn-primary sage-btn-sm" href="/launch?do=pay"><Rocket size={14} /> Post work</Link>
        </div>
      </header>

      <section className="ws-stats" aria-label="At a glance">
        <div className="ws-stat"><span className="ws-stat-v">{live.length}</span><span className="ws-stat-k">Open work</span></div>
        <div className="ws-stat"><span className="ws-stat-v">{inReview}</span><span className="ws-stat-k">In review</span></div>
        <div className={`ws-stat${paidUsd > 0 ? " pos" : ""}`}><span className="ws-stat-v">{usd(paidUsd)}</span><span className="ws-stat-k">Paid · {paidCount} payout{paidCount === 1 ? "" : "s"}</span></div>
        <div className="ws-stat"><span className="ws-stat-v">{view.memberCount}</span><span className="ws-stat-k">People</span></div>
      </section>

      <NextMove />

      <SettlingLane title="Settling — the finalization window" />

      {fresh && (
        <section className="ws-card">
          <div className="ws-card-h"><h2><Sparkles size={15} /> Three moves to your first verified payout</h2></div>
          <ol className="ws-check">
            <li className={invited ? "done" : ""}>
              <span className="ws-check-n">{invited ? <CheckCircle2 size={13} /> : "1"}</span>
              <span className="ws-check-t">Invite your people</span>
              <span className="ws-check-s">A link for wallets, or a Telegram link that gives them a wallet — no app, no seed phrase.</span>
              <Link href="/workspace/people">Invite →</Link>
            </li>
            <li className={posted ? "done" : ""}>
              <span className="ws-check-n">{posted ? <CheckCircle2 size={13} /> : "2"}</span>
              <span className="ws-check-t">Post the work</span>
              <span className="ws-check-s">A gig, a milestone grant or a testing run — members-only, or open to the public board, where Sage approves at once and finalizes after a window it uses to watch for copies and wallet clusters.</span>
              <Link href="/launch?do=pay">Post work →</Link>
            </li>
            <li className={paid ? "done" : ""}>
              <span className="ws-check-n">{paid ? <CheckCircle2 size={13} /> : "3"}</span>
              <span className="ws-check-t">Fund it once</span>
              <span className="ws-check-s">Fund a treasury once in Settings and Sage deploys, funds and activates every campaign from it — or fund each vault from your wallet. It cannot exceed what you funded.</span>
              <Link href="/workspace/settings">Treasury →</Link>
            </li>
          </ol>
        </section>
      )}

      <section className="ws-card">
        <div className="ws-card-h"><h2><Rocket size={15} /> Open work</h2><Link className="ws-chip" href="/dashboard">all work <ArrowUpRight size={11} /></Link></div>
        {live.length === 0 ? (
          <p className="ws-empty"><Inbox size={18} /><span>Nothing is open right now. <Link href="/launch?do=pay">Post work</Link> and your members hear about it the moment it is live.</span></p>
        ) : (
          <ul className="ws-list">
            {live.map((c) => (
              <li key={c.id} className="ws-row">
                <div className="ws-row-main">
                  <p className="ws-row-title"><span className="ws-livedot" aria-hidden /><Link href={`/campaign/${c.id}`}>{c.title}</Link></p>
                  <p className="ws-row-meta">{KIND[c.kind]} · {fmtReward(c.rewardBase, chainFor(c.rail))} each · {c.paid}/{c.slots} paid{c.pending ? ` · ${c.pending} in review` : ""} · {networkLabel(chainFor(c.rail))}</p>
                </div>
                <div className="ws-row-side">
                  <span className={`ws-chip${c.visibility === "unlisted" ? "" : " accent"}`}>{c.visibility === "unlisted" ? "members only" : "public"}</span>
                  <Link className="ws-chip" href={`/c/${c.id}`}>board <ArrowUpRight size={11} /></Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {view.desk.events.length > 0 && (
        <section className="ws-card">
          <div className="ws-card-h"><h2><Sparkles size={15} /> Sage at work</h2><Link className="ws-chip" href="/dashboard">everything <ArrowUpRight size={11} /></Link></div>
          <SageAtWork desk={view.desk} limit={6} />
        </section>
      )}
    </main>
  );
}
