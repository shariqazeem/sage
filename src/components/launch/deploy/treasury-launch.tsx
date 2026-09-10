"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Landmark, Loader2, Sparkles } from "lucide-react";

interface Account { chainId: number; network: string; address: string; isMainnet: boolean }
interface Status { linked: boolean; address?: string; balanceUsd?: number; enoughGas?: boolean | null; perCampaignCapUsd?: number; chainId?: number; network?: string; isMainnet?: boolean; accounts?: Account[] }
interface Launched { campaignId: string; url: string; steps: { step: string; explorerUrl: string }[] }

/**
 * "LET SAGE LAUNCH IT." When the founder has an account, the wallet-driven deploy below is optional:
 * one click and the agent deploys, funds and activates the vault from the account, inside the
 * mandate. The refusals are the account's own sentences (cap, balance, gas).
 *
 * One door per account: a founder holding an account on GOAT and one on Arc testnet sees both, each
 * naming its chain and balance, so a mainnet plan is never launched from test USDC by accident.
 */
export function TreasuryLaunch({ jobId, budgetUsd }: { jobId: string; budgetUsd: number }) {
  const [doors, setDoors] = useState<Status[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Launched | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const first = (await (await fetch("/api/treasury", { cache: "no-store" })).json()) as Status;
        const others = (first.accounts ?? []).filter((a) => a.chainId !== first.chainId);
        const rest = await Promise.all(others.map(async (a) => (await (await fetch(`/api/treasury?chainId=${a.chainId}`, { cache: "no-store" })).json()) as Status));
        if (live) setDoors([first, ...rest].filter((s) => s.linked));
      } catch {
        if (live) setDoors([]);
      }
    })();
    return () => { live = false; };
  }, []);

  if (!doors || doors.length === 0) return null;

  const launch = async (chainId: number | undefined) => {
    setBusy(chainId ?? 0);
    setErr(null);
    try {
      const r = await fetch(`/api/launch/${jobId}/treasury`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId }) });
      const j = (await r.json()) as Launched & { error?: string };
      if (!r.ok) {
        setErr(j.error ?? "Could not launch from your account.");
        return;
      }
      setDone(j);
    } catch {
      setErr("Network error — try again.");
    } finally {
      setBusy(null);
    }
  };

  if (done) {
    return (
      <div className="lxd-panel" style={{ marginBottom: 14 }}>
        <p className="lx-sub"><Sparkles size={14} /> Sage deployed, funded and activated the vault from your account. The campaign is live.</p>
        <div className="ws-nav" style={{ marginTop: 8 }}>
          <Link className="sage-btn sage-btn-primary sage-btn-sm" href={`/campaign/${done.campaignId}`}>Open the console <ArrowUpRight size={13} /></Link>
          <a className="ws-chip" href={done.url} target="_blank" rel="noopener noreferrer">the board</a>
          {done.steps.map((s) => <a key={s.step} className="ws-chip" href={s.explorerUrl} target="_blank" rel="noopener noreferrer">{s.step} tx</a>)}
        </div>
      </div>
    );
  }

  return (
    <div className="lxd-panel" style={{ marginBottom: 14 }}>
      {doors.map((st) => {
        const short = st.balanceUsd !== undefined && st.balanceUsd < budgetUsd;
        const network = st.network ?? "your account";
        return (
          <div key={st.chainId ?? "default"} style={{ display: "grid", gap: 8 }}>
            <p className="lx-sub"><Landmark size={14} /> Your account on {network} holds ${(st.balanceUsd ?? 0).toFixed(2)} {st.isMainnet === false ? "test " : ""}USDC{st.enoughGas === false ? " and needs gas" : ""}. This campaign needs ${budgetUsd.toFixed(2)}.{short ? " Top it up, or deploy from your wallet below." : st.isMainnet === false ? " Sage can launch it now, on the testnet — the work pays test USDC." : " Sage can launch it now — no wallet steps."}</p>
            <div className="ws-nav">
              <button className="sage-btn sage-btn-primary sage-btn-sm" onClick={() => void launch(st.chainId)} disabled={busy !== null || short || st.enoughGas === false}>
                {busy === (st.chainId ?? 0) ? <><Loader2 size={13} className="sage-spin2" /> Sage is launching…</> : <><Sparkles size={13} /> Let Sage launch it from your account on {network}</>}
              </button>
              <span className="ws-note" style={{ margin: 0 }}>Cap ${st.perCampaignCapUsd?.toFixed(2)} per campaign · unspent returns to you</span>
            </div>
          </div>
        );
      })}
      {err && <p className="ws-err">{err}</p>}
    </div>
  );
}
