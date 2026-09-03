"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Landmark, Loader2 } from "lucide-react";

interface Status { linked: boolean; available?: boolean; address?: string; reclaimAddress?: string; perCampaignCapUsd?: number; balanceUsd?: number; gasBtc?: string | null; enoughGas?: boolean | null }

/**
 * THE TREASURY. Fund it once; the agent deploys, funds and activates every campaign from it inside
 * a per-campaign cap the mandate enforces — no wallet popup per launch. The founder's own wallet is
 * the reclaim address: what the agent does not spend can only go back there.
 */
export function TreasuryCard() {
  const [st, setSt] = useState<Status | null>(null);
  const [cap, setCap] = useState("50");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const r = await fetch("/api/treasury", { cache: "no-store" });
      setSt(r.ok ? ((await r.json()) as Status) : { linked: false, available: false });
    } catch {
      setSt({ linked: false, available: false });
    }
  };
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20000);
    return () => clearInterval(t);
  }, []);

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/treasury", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ perCampaignCapUsd: Number(cap) || 50 }) });
      const j = (await r.json()) as Status & { error?: string };
      if (!r.ok) {
        setErr(j.error ?? "Could not create the treasury.");
        return;
      }
      setSt({ ...j, linked: true });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* visible to select */
    }
  };

  return (
    <section className="ws-card">
      <div className="ws-card-h"><h2><Landmark size={15} /> Treasury</h2>{st?.linked && <span className="ws-chip live">funded once, launches itself</span>}</div>
      {st === null ? (
        <p className="ws-note" style={{ margin: 0 }}><Loader2 size={13} className="sage-spin2" /> Reading…</p>
      ) : st.linked ? (
        <>
          <ul className="ws-list">
            <li className="ws-row">
              <div className="ws-row-main"><p className="ws-row-title"><span className="mono t">{st.address}</span></p><p className="ws-row-meta">Send USDC on GOAT here, plus about 0.00001 BTC for gas. Sage launches every campaign from it.</p></div>
              <button className="ws-chip" onClick={() => void copy(st.address ?? "")}>{copied ? <><Check size={11} /> copied</> : <><Copy size={11} /> copy</>}</button>
            </li>
            <li className="ws-row">
              <div className="ws-row-main"><p className="ws-row-title"><span className="t">Balance</span></p><p className="ws-row-meta">Gas {st.gasBtc ?? "—"} BTC{st.enoughGas === false ? " · needs gas to launch" : ""}</p></div>
              <span className="mono" style={{ fontSize: 14, fontVariantNumeric: "tabular-nums" }}>${(st.balanceUsd ?? 0).toFixed(2)}</span>
            </li>
            <li className="ws-row">
              <div className="ws-row-main"><p className="ws-row-title"><span className="t">Mandate</span></p><p className="ws-row-meta">Up to ${st.perCampaignCapUsd?.toFixed(2)} per campaign. Anything unspent can only return to {st.reclaimAddress?.slice(0, 6)}…{st.reclaimAddress?.slice(-4)} — your own wallet.</p></div>
            </li>
          </ul>
        </>
      ) : (
        <>
          <p className="ws-note" style={{ margin: "0 0 12px" }}>Fund once, and Sage deploys, funds and activates each campaign itself, inside a per-campaign cap the mandate enforces. Your wallet stays the only place unspent money can go back to.</p>
          {st.available === false ? (
            <p className="ws-note" style={{ margin: 0 }}>Treasuries bind to an Ethereum account on GOAT — sign in with one (an email account works) to create yours.</p>
          ) : (
            <div className="ws-invite" style={{ marginTop: 0 }}>
              <input className="ws-input" type="number" min="1" max="10000" step="1" value={cap} onChange={(e) => setCap(e.target.value)} aria-label="Per-campaign cap in USDC" />
              <button className="sage-btn sage-btn-primary sage-btn-sm" onClick={() => void create()} disabled={busy}>{busy ? <><Loader2 size={13} className="sage-spin2" /> Creating…</> : "Create treasury"}</button>
            </div>
          )}
          {err && <p className="ws-err">{err}</p>}
        </>
      )}
    </section>
  );
}
