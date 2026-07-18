"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Inbox,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { short, reward as fmtReward } from "@/lib/format";
import type { ActivityEvent } from "@/lib/campaigns/activity";
import "@/styles/tester-board.css";

export interface ActivityData {
  activity: ActivityEvent[];
  lastCheckedAt: number | null;
}

/** relative "Xm ago" — computed client-side only (see `now === null` guard). */
function ago(fromSec: number, nowSec: number): string {
  const d = Math.max(0, nowSec - fromSec);
  if (d < 45) return "just now";
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return `${Math.round(d / 86400)}d ago`;
}

function sig(d: ActivityData): string {
  return `${d.lastCheckedAt ?? 0}:${d.activity.map((a) => a.id).join(",")}`;
}

/**
 * The public "Sage activity" strip — the agent's work, observable. Server-seeded, then
 * polled on the board's 5s cadence so anyone (no wallet, no sign-in) watches Sage receive,
 * verify, pay, hold, and block in real time. Every line is a real row (see activity.ts);
 * held/blocked show a coarse class only — never evidence, notes, or reason text.
 *
 * Also carries the honest heartbeat: "Sage last checked Xm ago", derived from the last
 * moment Sage actually recorded work — never a fake pulse. >10m surfaces "may be delayed".
 */
export function SageActivity({
  campaignId,
  chainId,
  initial,
  pending = false,
  complete = false,
}: {
  campaignId: string;
  chainId: number;
  initial: ActivityData;
  /** is there work awaiting Sage (a pending submission)? */
  pending?: boolean;
  /** has the campaign ended (all paid / budget spent / closed)? */
  complete?: boolean;
}) {
  const [data, setData] = useState<ActivityData>(initial);
  const lastSig = useRef<string>(sig(initial));
  // null until mounted → relative times render only client-side (no hydration mismatch).
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const stamp = () => setNow(Math.floor(Date.now() / 1000));
    stamp();
    const clock = setInterval(stamp, 20000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/public`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const j = (await res.json()) as Partial<ActivityData>;
        const next: ActivityData = {
          activity: j.activity ?? [],
          lastCheckedAt: j.lastCheckedAt ?? null,
        };
        const s = sig(next);
        if (s === lastSig.current) return;
        lastSig.current = s;
        setData(next);
      } catch {
        /* transient — the next tick retries */
      }
    };
    const timer = setInterval(() => void tick(), 5000);
    const onVis = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [campaignId]);

  return (
    <div className="tb-act">
      <div className="tb-act-h">
        <span>Sage activity</span>
        <Heartbeat lastCheckedAt={data.lastCheckedAt} now={now} pending={pending} complete={complete} />
      </div>
      <div className="tb-act-list">
        {data.activity.length > 0 ? (
          data.activity.map((a) => (
            <Line key={a.id} a={a} chainId={chainId} now={now} />
          ))
        ) : (
          <div className="tb-act-empty">No activity yet — be the first.</div>
        )}
      </div>
    </div>
  );
}

function Heartbeat({
  lastCheckedAt,
  now,
  pending = false,
  complete = false,
}: {
  lastCheckedAt: number | null;
  now: number | null;
  /** is there work awaiting Sage right now (pending submissions)? */
  pending?: boolean;
  /** has the campaign ended (all slots paid / budget spent / closed)? */
  complete?: boolean;
}) {
  // A finished campaign is COMPLETE, never "delayed" — there is nothing left for Sage to do.
  if (complete) {
    return (
      <span className="tb-beat">
        <span className="tb-beat-dot" /> Sage is done — all work settled
      </span>
    );
  }
  if (lastCheckedAt == null) {
    return (
      <span className="tb-beat">
        <span className="tb-beat-dot" /> Sage is standing by
      </span>
    );
  }
  // Before mount `now` is null — render a stable, non-alarming label (no fake freshness).
  if (now == null) {
    return (
      <span className="tb-beat">
        <span className="tb-beat-dot" /> Sage is live
      </span>
    );
  }
  // "Delayed" only when it's TRUE: there is pending work AND Sage hasn't acted recently. With no
  // pending work, a quiet campaign is simply standing by, not delayed.
  const delayed = pending && now - lastCheckedAt > 600;
  return (
    <span className={`tb-beat${delayed ? " warn" : ""}`}>
      <span className="tb-beat-dot" />
      {delayed ? "Sage may be delayed" : pending ? `Sage last checked ${ago(lastCheckedAt, now)}` : "Sage is standing by"}
    </span>
  );
}

function Line({
  a,
  chainId,
  now,
}: {
  a: ActivityEvent;
  chainId: number;
  now: number | null;
}) {
  let icon: ReactNode;
  let text: ReactNode;
  let tone = "";
  switch (a.kind) {
    case "received":
      icon = <Inbox size={14} />;
      text = "New submission received";
      break;
    case "verified":
      icon = <ShieldCheck size={14} />;
      tone = "accent";
      text =
        a.confidencePct != null
          ? `Evidence verified · ${a.confidencePct}% confidence`
          : "Evidence verified";
      break;
    case "paid":
      icon = <CheckCircle2 size={14} />;
      tone = "pos";
      text = (
        <>
          Paid{" "}
          <b className="mono">
            {a.amountBase != null ? fmtReward(a.amountBase, chainId) : "reward"}
          </b>
          {a.wallet ? (
            <>
              {" "}
              to <span className="mono">{short(a.wallet)}</span>
            </>
          ) : null}
        </>
      );
      break;
    case "held":
      icon = <Clock size={14} />;
      tone = "warn";
      text = "Held for review";
      break;
    case "blocked":
      icon = <XCircle size={14} />;
      tone = "dan";
      text = `Blocked · ${a.reasonClass ?? "integrity check"}`;
      break;
  }
  return (
    <div className={`tb-act-row${tone ? ` ${tone}` : ""}`}>
      <span className="tb-act-ico">{icon}</span>
      <span className="tb-act-text">{text}</span>
      {a.kind === "paid" && a.txHash ? (
        <a className="tb-act-proof" href={`/proof/${a.txHash}`}>
          <ArrowUpRight size={12} /> proof
        </a>
      ) : null}
      <span className="tb-act-time">{now != null ? ago(a.at, now) : ""}</span>
    </div>
  );
}
