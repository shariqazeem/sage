import Link from "next/link";
import { ArrowUpRight, Briefcase, CheckCircle2, Clock } from "lucide-react";
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

/** A member's home: the work their teams have open, and where each of their own submissions stands. */
export function MemberWorkspace({ view }: { view: MemberView }) {
  return (
    <main className="ws-shell">
      <div className="ws-head">
        <div>
          <div className="sage-eyebrow"><Briefcase size={13} /> Your work</div>
          <h1 className="ws-title">{view.teams.map((t) => t.name).join(" · ")}</h1>
          <p className="ws-sub">Signed in as <span className="mono">{short(view.address)}</span>. Everything below pays to this wallet once Sage verifies it.</p>
        </div>
      </div>
      <div className="ws-card">
        <div className="ws-card-h"><h2>Open work</h2></div>
        {view.work.length === 0 ? (
          <p className="ws-empty">Nothing is open right now. Your team will post work here; if you joined from Telegram, Sage messages you when it does.</p>
        ) : (
          <ul className="ws-list">
            {view.work.map((w) => (
              <li key={w.id} className="ws-row">
                <div className="ws-row-main">
                  <p className="ws-row-title"><Link href={`/c/${w.id}`}>{w.title}</Link></p>
                  <p className="ws-row-meta">{w.team} · {w.kind} · pays {fmtReward(w.rewardBase, chainFor(w.rail))} · {networkLabel(chainFor(w.rail))}</p>
                </div>
                <div className="ws-row-side">
                  {w.myStatus === "paid" ? (
                    <span className="ws-chip paid"><CheckCircle2 size={12} /> paid</span>
                  ) : w.myStatus ? (
                    <span className="ws-chip"><Clock size={12} /> {w.myStatus}</span>
                  ) : (
                    <Link className="sage-btn sage-btn-sm sage-btn-primary" href={`/c/${w.id}`}>Do it <ArrowUpRight size={13} /></Link>
                  )}
                  {w.myPayoutTx && <a className="ws-chip" href={`/proof/${w.myPayoutTx}`}>receipt</a>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="ws-card">
        <div className="ws-card-h"><h2>Your record</h2></div>
        <p className="ws-empty">Every verified payout builds your record — a portable history of work Sage has verified and paid. <Link href={`/record/${view.address}`}>Open your record</Link>.</p>
      </div>
    </main>
  );
}
