import Link from "next/link";
import { ArrowUpRight, Briefcase, CheckCircle2, Clock, FileText, Inbox } from "lucide-react";
import { reward as fmtReward, networkLabel, short } from "@/lib/format";
import type { SettlementRail } from "@/lib/db/schema";

export interface MemberView {
  address: string;
  teams: { id: string; name: string }[];
  work: {
    id: string;
    title: string;
    team: string;
    kind: "testing" | "grant" | "gig";
    rail: SettlementRail;
    rewardBase: number;
    myStatus: string | null;
    myPayoutTx: string | null;
  }[];
}

const chainFor = (rail: SettlementRail) => (rail === "starknet" ? 900001 : 2345);
const KIND = { testing: "Testing run", grant: "Milestone grant", gig: "Gig" } as const;

/** A member's home: the work their teams have open, and where each of their own submissions stands. */
export function MemberWorkspace({ view }: { view: MemberView }) {
  const paid = view.work.filter((w) => w.myStatus === "paid").length;
  return (
    <main className="ws-shell ws-stagger">
      <header className="ws-head">
        <div>
          <span className="ws-eyebrow">Your work</span>
          <h1 className="ws-title">{view.teams.map((t) => t.name).join(" · ")}</h1>
          <p className="ws-sub">Signed in as <span className="mono">{short(view.address)}</span>. Everything below pays to this wallet once Sage verifies it.</p>
        </div>
        <div className="ws-nav"><Link className="ws-chip" href={`/record/${view.address}`}><FileText size={12} /> My record</Link></div>
      </header>

      <section className="ws-stats" aria-label="At a glance">
        <div className="ws-stat"><span className="ws-stat-v">{view.work.length}</span><span className="ws-stat-k">Open work</span></div>
        <div className="ws-stat"><span className="ws-stat-v">{view.work.filter((w) => w.myStatus && w.myStatus !== "paid").length}</span><span className="ws-stat-k">Submitted</span></div>
        <div className={`ws-stat${paid ? " pos" : ""}`}><span className="ws-stat-v">{paid}</span><span className="ws-stat-k">Paid</span></div>
        <div className="ws-stat"><span className="ws-stat-v">{view.teams.length}</span><span className="ws-stat-k">Team{view.teams.length === 1 ? "" : "s"}</span></div>
      </section>

      <section className="ws-card">
        <div className="ws-card-h"><h2><Briefcase size={15} /> Open work</h2></div>
        {view.work.length === 0 ? (
          <p className="ws-empty"><Inbox size={18} /><span>Nothing is open right now. Your team will post work here; if you joined from Telegram, Sage messages you when it does.</span></p>
        ) : (
          <ul className="ws-list">
            {view.work.map((w) => (
              <li key={w.id} className="ws-row">
                <div className="ws-row-main">
                  <p className="ws-row-title"><Link href={`/c/${w.id}`}>{w.title}</Link></p>
                  <p className="ws-row-meta">{w.team} · {KIND[w.kind]} · pays {fmtReward(w.rewardBase, chainFor(w.rail))} · {networkLabel(chainFor(w.rail))}</p>
                </div>
                <div className="ws-row-side">
                  {w.myStatus === "paid" ? (
                    <span className="ws-chip paid"><CheckCircle2 size={12} /> paid</span>
                  ) : w.myStatus ? (
                    <span className="ws-chip warn"><Clock size={12} /> {w.myStatus === "pending" ? "in review" : w.myStatus}</span>
                  ) : (
                    <Link className="sage-btn sage-btn-sm sage-btn-primary" href={`/c/${w.id}`}>Do it <ArrowUpRight size={13} /></Link>
                  )}
                  {w.myPayoutTx && <Link className="ws-chip" href={`/proof/${w.myPayoutTx}`}>receipt</Link>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ws-card">
        <div className="ws-card-h"><h2><FileText size={15} /> Your record</h2></div>
        <p className="ws-note" style={{ margin: 0 }}>Every verified payout builds your record — a portable history of work Sage has verified and paid, that you can show a programme or a lender. <Link href={`/record/${view.address}`}>Open your record</Link>.</p>
      </section>
    </main>
  );
}
