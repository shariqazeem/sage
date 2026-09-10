"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Copy, Landmark, Loader2 } from "lucide-react";

interface Status {
  linked: boolean;
  available?: boolean;
  reason?: "starknet" | "unconfigured" | null;
  address?: string;
  reclaimAddress?: string;
  perCampaignCapUsd?: number;
  balanceUsd?: number;
  chainId?: number;
  network?: string;
  nativeSymbol?: string;
  gasNative?: string | null;
  enoughGas?: boolean | null;
}

/**
 * YOUR ACCOUNT, in one card: the wallet Sage holds for you under the mandate. Fund it once; the
 * agent deploys, funds and activates every campaign from it inside a per-campaign cap the mandate
 * enforces — no wallet popup per launch. The founder's own wallet is the reclaim address: what the
 * agent does not spend can only go back there. The full page (fund with a QR, withdraw, activity)
 * is /workspace/account; this card is the summary the autopilot and settings pages carry.
 *
 * One name everywhere. The code calls this object the "treasury"; the product calls it "your
 * account", and so does the rail. Two names for one thing read as two things.
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
        setErr(j.error ?? "Could not open the account.");
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

  const network = st?.network ?? "GOAT Network";
  const usdcIsGas = st?.nativeSymbol === "USDC";
  return (
    <section className="ws-card" id="account">
      <div className="ws-card-h">
        <h2><Landmark size={15} /> Your account</h2>
        {st?.linked ? <Link className="ws-chip" href="/workspace/account">fund · withdraw · activity <ArrowUpRight size={11} /></Link> : null}
      </div>
      {st === null ? (
        <p className="ws-note" style={{ margin: 0 }}><Loader2 size={13} className="sage-spin2" /> Reading…</p>
      ) : st.linked ? (
        <>
          <ul className="ws-list">
            <li className="ws-row">
              <div className="ws-row-main"><p className="ws-row-title"><span className="mono t">{st.address}</span></p><p className="ws-row-meta">Send USDC on {network} here{usdcIsGas ? " — there, USDC is the gas too, so that is all it needs" : `, plus a little ${st.nativeSymbol ?? "gas"} for gas`}. Sage launches every campaign from it.</p></div>
              <button className="ws-chip" onClick={() => void copy(st.address ?? "")}>{copied ? <><Check size={11} /> copied</> : <><Copy size={11} /> copy</>}</button>
            </li>
            <li className="ws-row">
              <div className="ws-row-main"><p className="ws-row-title"><span className="t">Balance</span></p><p className="ws-row-meta">{usdcIsGas ? `USDC on ${network} · gas included` : `USDC on ${network} · gas ${st.gasNative ?? "—"} ${st.nativeSymbol ?? ""}${st.enoughGas === false ? " · needs gas to launch" : ""}`}</p></div>
              <span className="mono" style={{ fontSize: 14, fontVariantNumeric: "tabular-nums" }}>${(st.balanceUsd ?? 0).toFixed(2)}</span>
            </li>
            <li className="ws-row">
              <div className="ws-row-main"><p className="ws-row-title"><span className="t">Mandate</span></p><p className="ws-row-meta">Up to ${st.perCampaignCapUsd?.toFixed(2)} per campaign. Anything unspent can only return to {st.reclaimAddress?.slice(0, 6)}…{st.reclaimAddress?.slice(-4)} — your own wallet.</p></div>
            </li>
          </ul>
        </>
      ) : st.available === false ? (
        <p className="ws-note" style={{ margin: 0 }}>
          {st.reason === "starknet"
            ? <>The account is a wallet Sage holds for you on {network}, so it opens with an email or an Ethereum wallet sign-in. Your Starknet work is unaffected: you fund each launch from your own wallet, and every payout settles through the Cairo vault.</>
            : <>Accounts aren&apos;t configured on this deployment.</>}
        </p>
      ) : (
        <>
          <p className="ws-note" style={{ margin: "0 0 12px" }}>Fund once, and Sage deploys, funds and activates each campaign itself, inside a per-campaign cap the mandate enforces. Your wallet stays the only place unspent money can go back to.</p>
          <div className="ws-invite" style={{ marginTop: 0 }}>
            <input className="ws-input" type="number" min="1" max="10000" step="1" value={cap} onChange={(e) => setCap(e.target.value)} aria-label="Per-campaign cap in USDC" />
            <button className="sage-btn sage-btn-primary sage-btn-sm" onClick={() => void create()} disabled={busy}>{busy ? <><Loader2 size={13} className="sage-spin2" /> Opening…</> : `Open your account on ${network}`}</button>
          </div>
          <p className="ws-note" style={{ margin: "8px 0 0" }}>The number is the most Sage may ever put into one campaign from this account. It is written into the account&apos;s mandate and cannot be raised afterwards, so pick the largest campaign you would fund; the standing mandate can always set a lower ceiling.</p>
          {err && <p className="ws-err">{err}</p>}
        </>
      )}
    </section>
  );
}
