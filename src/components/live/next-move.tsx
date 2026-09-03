"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Compass } from "lucide-react";

/**
 * THE AGENT'S NEXT MOVE. A founder who funds once should not be left watching a dashboard for signs
 * of life. This is the decision itself, before it happens: what Sage intends to buy, why, what it
 * costs, and how long is left to argue with it. The ring is the same object as the settling lane's,
 * because it is the same kind of fact — a real clock on real money.
 *
 * When there is nothing to propose it says the actual constraint rather than idling, so the pause is
 * legible too: a treasury at its floor, a week's ceiling reached, a board still unclaimed.
 */
interface Proposal {
  id: string;
  state: "proposed" | "committed" | "launched" | "vetoed" | "abandoned";
  surface: string | null;
  kind: "testing" | "gig" | "grant";
  goal: string;
  reason: string;
  budgetBase: number;
  commitAt: number;
  campaignId: string | null;
  decidedBy: "llm" | "rules";
  createdAt: number;
}
interface Data {
  armed: boolean;
  now: number;
  mandate: { productUrl: string | null } | null;
  treasury: { balanceBase: number } | null;
  committedThisWeekBase: number;
  exposureBase: number;
  liveCount: number;
  stance: { moving: boolean; reason: string } | null;
  proposals: Proposal[];
}

const usd = (b: number) => `$${(b / 1e6).toFixed(2)}`;
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
const KIND = { testing: "testing run", gig: "gig", grant: "milestone grant" } as const;

export function NextMove() {
  const [data, setData] = useState<Data | null>(null);
  const [skew, setSkew] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const load = async () => {
    try {
      const r = await fetch("/api/operator", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as Data;
      setSkew(j.now - Math.floor(Date.now() / 1000));
      setData(j);
    } catch {
      /* next poll */
    }
  };
  useEffect(() => {
    void load();
    const p = setInterval(() => void load(), 20000);
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => { clearInterval(p); clearInterval(t); };
  }, []);

  if (!data || !data.armed) return null;
  const now = Math.floor(Date.now() / 1000) + skew;
  const open = data.proposals.find((p) => p.state === "proposed");
  const working = data.proposals.find((p) => p.state === "committed");
  const recent = data.proposals.filter((p) => p.state === "launched" || p.state === "vetoed").slice(0, 3);
  const R = 24, C = 2 * Math.PI * R;

  const act = async (id: string, action: "veto" | "now") => {
    setBusy(id + action);
    try {
      await fetch(`/api/operator/proposals/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const left = open ? open.commitAt - now : 0;
  const span = open ? Math.max(1, open.commitAt - open.createdAt) : 1;

  return (
    <section className="lv-card">
      <div className="lv-h">
        <h2><Compass size={15} /> What Sage is doing next</h2>
        <span className="lv-tele">
          <span><b>{usd(data.treasury?.balanceBase ?? 0)}</b> in the treasury</span>
          <span><b>{usd(data.committedThisWeekBase)}</b> committed this week</span>
          <span><b>{data.liveCount}</b> running</span>
        </span>
      </div>

      {open ? (
        <div className="nm-move">
          <div className="lv-ring approved">
            <svg viewBox="0 0 56 56" aria-hidden>
              <circle className="track" cx="28" cy="28" r={R} />
              <circle className="prog" cx="28" cy="28" r={R} style={{ strokeDasharray: C, strokeDashoffset: C * (1 - Math.max(0, Math.min(1, left / span))) }} />
            </svg>
            <div className="mid">{left > 0 ? mmss(left) : "now"}</div>
          </div>
          <div className="nm-body">
            <p className="nm-head">
              <b>{usd(open.budgetBase)} {KIND[open.kind]}</b> on <span className="mono">{open.surface}</span>
            </p>
            <p className="nm-goal">{open.goal}</p>
            <p className="nm-why">{open.reason}</p>
          </div>
          <div className="nm-act">
            <button type="button" className="nm-btn" disabled={busy !== null} onClick={() => void act(open.id, "now")}>
              {busy === open.id + "now" ? "…" : "Go now"}
            </button>
            <button type="button" className="nm-btn ghost" disabled={busy !== null} onClick={() => void act(open.id, "veto")}>
              {busy === open.id + "veto" ? "…" : "Not this one"}
            </button>
          </div>
        </div>
      ) : working ? (
        <p className="nm-state">
          Designing the missions for a {usd(working.budgetBase)} {KIND[working.kind]} on <span className="mono">{working.surface}</span>. It funds and goes live on its own when the plan passes the gate.
        </p>
      ) : (
        <p className="nm-state">{data.stance?.reason ? capital(data.stance.reason) : "Reading the board."}</p>
      )}

      {recent.length > 0 && (
        <ul className="lv-tape" aria-label="Recent moves">
          {recent.map((p) => (
            <li key={p.id}>
              <span className={`k ${p.state === "launched" ? "paid" : "revoked"}`}>{p.state === "launched" ? "launched" : "vetoed"}</span>
              <span className="t">{usd(p.budgetBase)} {KIND[p.kind]} on {p.surface} — {p.reason}</span>
              <span className="w">{p.campaignId ? <Link href={`/campaign/${p.campaignId}`}>open</Link> : null}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
