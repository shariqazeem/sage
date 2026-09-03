"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import type { LaneTicket } from "@/lib/lane/lane";

interface LaneData { now: number; lane: LaneTicket[]; tape: { id: string; kind: "paid" | "revoked" | "held"; text: string; txHash: string | null; at: number; campaignTitle: string }[] }

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (base: number) => `$${(base / 1e6).toFixed(2)}`;
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
const ago = (s: number) => (s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`);

/**
 * THE SETTLING LANE. Each ticket is a payout the agent approved on an open campaign: a ring counts
 * its finalization window down, three lights show what the watch reads right now (near-duplicate,
 * copied artifact, wallet cluster), and the ticket leaves the lane only when the ledger records a
 * settlement or a revocation. Polls the server; the second hand ticks locally.
 */
export function SettlingLane({ campaignId, title = "Settling" }: { campaignId?: string; title?: string }) {
  const [data, setData] = useState<LaneData | null>(null);
  const [skew, setSkew] = useState(0);
  const [tick, setTick] = useState(0);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(campaignId ? `/api/campaigns/${campaignId}/lane` : "/api/lane", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as LaneData;
        if (!alive) return;
        setSkew(j.now - Math.floor(Date.now() / 1000));
        setData(j);
      } catch {
        /* next poll */
      }
    };
    void load();
    const p = setInterval(() => void load(), 15000);
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => { alive = false; clearInterval(p); clearInterval(t); };
  }, [campaignId]);

  if (!data) return null;
  const now = Math.floor(Date.now() / 1000) + skew;
  const R = 24, C = 2 * Math.PI * R;
  void tick;

  return (
    <section className="lv-card">
      <div className="lv-h">
        <h2><Clock size={15} /> {title}</h2>
        <span className="lv-tele"><span><b>{data.lane.filter((t) => t.state === "approved").length}</b> in the window</span><span><b>{data.lane.filter((t) => t.state === "paid").length}</b> finalized · 6h</span><span><b>{data.lane.filter((t) => t.state === "revoked").length}</b> revoked · 6h</span></span>
      </div>
      {data.lane.length === 0 ? (
        <p className="lv-empty">No payout is in the window right now. On an open campaign the agent approves at once and settles after the window; members-only work pays immediately.</p>
      ) : (
        <div className="lv-lane" aria-label="Payouts in the finalization window">
          {data.lane.map((t) => {
            const isNew = !seen.current.has(t.id);
            seen.current.add(t.id);
            const remaining = t.finalizesAt ? t.finalizesAt - now : 0;
            const frac = t.state === "approved" && t.finalizesAt && t.windowSec > 0 ? Math.max(0, Math.min(1, remaining / t.windowSec)) : t.state === "paid" ? 1 : 0;
            const flagged = t.lights && (t.lights.nearDup === "flag" || t.lights.copied === "flag" || t.lights.cluster === "flag");
            return (
              <div key={t.id} className={`lv-t ${t.state}${isNew ? " enter" : ""}`} title={t.campaignTitle}>
                <div className={`lv-ring ${t.state}`}>
                  <svg viewBox="0 0 56 56" aria-hidden><circle className="track" cx="28" cy="28" r={R} /><circle className="prog" cx="28" cy="28" r={R} style={{ strokeDasharray: C, strokeDashoffset: C * (1 - frac) }} /></svg>
                  <div className="mid">{t.state === "approved" ? (remaining > 0 ? mmss(remaining) : "due") : t.state === "settling" ? "…" : t.state === "paid" ? "paid" : "×"}</div>
                </div>
                <div className="lv-t-amt">{usd(t.rewardBase)} <span style={{ fontWeight: 500, color: "var(--ink-faint)", fontSize: 11 }}>{t.rail === "starknet" ? "Starknet · private" : "GOAT"}</span></div>
                <div className="lv-t-who">{short(t.wallet)}{campaignId ? "" : ` · ${t.campaignTitle}`}</div>
                {t.lights ? (
                  <div className="lv-lights">
                    <span className={`lv-light ${t.lights.nearDup}`}><i />dup</span>
                    <span className={`lv-light ${t.lights.copied}`}><i />copy</span>
                    <span className={`lv-light ${t.lights.cluster}`}><i />cluster</span>
                  </div>
                ) : (
                  <div className="lv-lights"><span className="lv-light">{t.state === "paid" ? `finalized ${ago(now - t.at)} ago` : `revoked ${ago(now - t.at)} ago`}</span></div>
                )}
                {t.state === "approved" && flagged && t.reason && <p className="lv-t-reason">The watch will revoke at maturity: {t.reason}</p>}
                {t.state === "revoked" && t.reason && <p className="lv-t-reason">{t.reason}</p>}
                {t.state === "paid" && t.txHash && <p className="lv-t-link"><Link href={`/proof/${t.txHash}`}>receipt {t.txHash.slice(0, 10)}…</Link></p>}
              </div>
            );
          })}
        </div>
      )}
      {data.tape.length > 0 && (
        <ul className="lv-tape" aria-label="Recent settlements and refusals">
          {data.tape.slice(0, 6).map((r) => (
            <li key={r.id}>
              <span className={`k ${r.kind}`}>{r.kind}</span>
              <span className="t">{(r.text || r.campaignTitle).replace(/\bDeputy\b/g, "Sage")}</span>
              <span className="w">{r.txHash ? <Link href={`/proof/${r.txHash}`}>receipt</Link> : ago(now - r.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
