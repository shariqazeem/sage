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
 * legible too: an account at its floor, a week's ceiling reached, a board still unclaimed.
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
/**
 * The account, in one of three states — has one, can open one, cannot. The door offered below
 * depends on which: a "fund it" button shown to someone who cannot open an account is not a call
 * to action, it is a dead end with a countdown.
 */
interface Account {
  available: boolean;
  reason: "starknet" | "unconfigured" | null;
  exists: boolean;
  balanceBase: number;
  network: string;
  isMainnet: boolean;
}
interface Data {
  armed: boolean;
  now: number;
  mandate: { productUrl: string | null; instruction: string | null } | null;
  treasury: { balanceBase: number } | null;
  account?: Account | null;
  committedThisWeekBase: number;
  exposureBase: number;
  liveCount: number;
  stance: { moving: boolean; reason: string; fix: { label: string; href: string } | null } | null;
  proposals: Proposal[];
  rehearsal?: {
    recorded: false;
    surface: string;
    kind: "testing" | "gig" | "grant";
    goal: string;
    reason: string;
    budgetBase: number;
    line: string;
    assumesFundingBase: number;
    because: string | null;
    /** the rule that decides WHEN (a full board), when the move is still shown */
    timing: string | null;
  } | null;
}

const usd = (b: number) => `$${(b / 1e6).toFixed(2)}`;
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
const KIND = { testing: "testing run", gig: "gig", grant: "milestone grant" } as const;

/** What the telemetry chip says about the account: a balance, or the plain state instead of a fake $0.00. */
function AccountTele({ data }: { data: Data }) {
  const a = data.account;
  if (!a) return <span><b>{usd(data.treasury?.balanceBase ?? 0)}</b> in your account</span>;
  if (a.exists) return <span><b>{usd(a.balanceBase)}</b> in your account</span>;
  if (a.available) return <span>no account yet</span>;
  return <span>{a.reason === "starknet" ? "no account on Starknet" : "accounts not configured here"}</span>;
}

/** The one door the founder can actually walk through from here. */
function AccountDoor({ data }: { data: Data }) {
  const a = data.account;
  if (!a || a.exists) return <Link href="/workspace/account" className="nm-btn">Fund it and Sage moves</Link>;
  if (a.available) return <Link href="/workspace/account" className="nm-btn">Open your account</Link>;
  if (a.reason === "starknet") {
    return <span className="nm-assume" style={{ margin: 0, maxWidth: 220 }}>Sage launches from an account it holds for you on {a.network}. It opens with an email or an Ethereum wallet sign-in; your Starknet work is unaffected.</span>;
  }
  return <span className="nm-assume" style={{ margin: 0, maxWidth: 220 }}>Accounts are not configured on this deployment.</span>;
}

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

  if (!data) return null;
  const R = 24, C = 2 * Math.PI * R;
  /*
    ALIVE AT $0. Unarmed, or an account at its floor, used to render nothing — the flagship "agent
    decides" feature was invisible to every new founder. The rehearsal is the same decision with the
    ring greyed and one door: fund it, and it will.
  */
  if (!data.armed || (data.rehearsal && !data.proposals.some((p) => p.state === "proposed" || p.state === "committed"))) {
    const r = data.rehearsal;
    return (
      <section className="lv-card">
        <div className="lv-h">
          <h2><Compass size={15} /> What Sage would do next</h2>
          <span className="lv-tele"><AccountTele data={data} /></span>
        </div>
        {r && !r.because ? (
          <div className="nm-move nm-rehearsal">
            <div className="lv-ring">
              <svg viewBox="0 0 56 56" aria-hidden>
                <circle className="track" cx="28" cy="28" r={R} />
              </svg>
              <div className="mid">—</div>
            </div>
            <div className="nm-body">
              {r.timing && <p className="nm-assume">{capital(r.timing)}. The move that follows:</p>}
              <p className="nm-head">
                <b>{usd(r.budgetBase)} {KIND[r.kind]}</b> on <span className="mono">{r.surface}</span>
              </p>
              <p className="nm-goal">{r.goal}</p>
              <p className="nm-why">{r.reason}</p>
              <p className="nm-assume">Sized as if your account held {usd(r.assumesFundingBase)}. Nothing is recorded until it does.</p>
            </div>
            <div className="nm-act">
              {data.armed && r.timing && (data.account?.exists ?? true) ? (
                <span className="nm-assume">Sage moves when a slot frees.</span>
              ) : (
                <AccountDoor data={data} />
              )}
            </div>
          </div>
        ) : (
          <div className="nm-blocked">
            {data.account && !data.account.available ? (
              /* No mandate form is offered to this founder, so the "name your product" door must not be either. */
              <p className="nm-state">
                {data.account.reason === "starknet"
                  ? `Sage decides what work to buy from an account it holds for you on ${data.account.network}. That account opens with an email or an Ethereum wallet sign-in; your Starknet work is unaffected.`
                  : "Accounts are not configured on this deployment, so Sage cannot decide what to buy here."}
              </p>
            ) : (
              <>
                <p className="nm-state">{r?.because ? capital(r.because) : "Reading the board."}</p>
                {r?.because && /name your product/i.test(r.because) && (
                  <Link href="/workspace/autopilot#mandate" className="nm-btn nm-fix">Name your product</Link>
                )}
              </>
            )}
          </div>
        )}
      </section>
    );
  }
  const now = Math.floor(Date.now() / 1000) + skew;
  const open = data.proposals.find((p) => p.state === "proposed");
  const working = data.proposals.find((p) => p.state === "committed");
  const recent = data.proposals.filter((p) => p.state === "launched" || p.state === "vetoed").slice(0, 3);

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
          <AccountTele data={data} />
          <span><b>{usd(data.committedThisWeekBase)}</b> committed this week</span>
          <span><b>{data.liveCount}</b> running</span>
        </span>
      </div>

      {data.mandate?.instruction ? (
        <p className="nm-instruction"><b>Your instruction:</b> {data.mandate.instruction}</p>
      ) : null}

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
        <div className="nm-blocked">
          <p className="nm-state">{data.stance?.reason ? capital(data.stance.reason) : "Reading the board."}</p>
          {data.stance?.fix && (
            <Link href={data.stance.fix.href} className="nm-btn nm-fix">{data.stance.fix.label}</Link>
          )}
        </div>
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
