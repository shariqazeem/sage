"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Landmark, Loader2, Sparkles } from "lucide-react";

interface Status { linked: boolean; address?: string; balanceUsd?: number; enoughGas?: boolean | null; perCampaignCapUsd?: number }
interface Launched { campaignId: string; url: string; steps: { step: string; explorerUrl: string }[] }

/**
 * "LET SAGE LAUNCH IT." When the founder has a treasury, the wallet-driven deploy below is optional:
 * one click and the agent deploys, funds and activates the vault from the treasury, inside the
 * mandate. The refusals are the treasury's own sentences (cap, balance, gas).
 */
export function TreasuryLaunch({ jobId, budgetUsd }: { jobId: string; budgetUsd: number }) {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Launched | null>(null);

  useEffect(() => {
    void fetch("/api/treasury", { cache: "no-store" }).then(async (r) => setSt(r.ok ? ((await r.json()) as Status) : { linked: false })).catch(() => setSt({ linked: false }));
  }, []);

  if (!st?.linked) return null;

  const launch = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/launch/${jobId}/treasury`, { method: "POST" });
      const j = (await r.json()) as Launched & { error?: string };
      if (!r.ok) {
        setErr(j.error ?? "Could not launch from the treasury.");
        return;
      }
      setDone(j);
    } catch {
      setErr("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="lxd-panel" style={{ marginBottom: 14 }}>
        <p className="lx-sub"><Sparkles size={14} /> Sage deployed, funded and activated the vault from your treasury. The campaign is live.</p>
        <div className="ws-nav" style={{ marginTop: 8 }}>
          <Link className="sage-btn sage-btn-primary sage-btn-sm" href={`/campaign/${done.campaignId}`}>Open the console <ArrowUpRight size={13} /></Link>
          <a className="ws-chip" href={done.url} target="_blank" rel="noopener noreferrer">the board</a>
          {done.steps.map((s) => <a key={s.step} className="ws-chip" href={s.explorerUrl} target="_blank" rel="noopener noreferrer">{s.step} tx</a>)}
        </div>
      </div>
    );
  }

  const short = st.balanceUsd !== undefined && st.balanceUsd < budgetUsd;
  return (
    <div className="lxd-panel" style={{ marginBottom: 14 }}>
      <p className="lx-sub"><Landmark size={14} /> Your treasury holds ${(st.balanceUsd ?? 0).toFixed(2)} USDC{st.enoughGas === false ? " and needs gas" : ""}. This campaign needs ${budgetUsd.toFixed(2)}.{short ? " Top it up, or deploy from your wallet below." : " Sage can launch it now — no wallet steps."}</p>
      <div className="ws-nav" style={{ marginTop: 8 }}>
        <button className="sage-btn sage-btn-primary sage-btn-sm" onClick={() => void launch()} disabled={busy || short || st.enoughGas === false}>
          {busy ? <><Loader2 size={13} className="sage-spin2" /> Sage is launching…</> : <><Sparkles size={13} /> Let Sage launch it from the treasury</>}
        </button>
        <span className="ws-note" style={{ margin: 0 }}>Cap ${st.perCampaignCapUsd?.toFixed(2)} per campaign · unspent returns to you</span>
      </div>
      {err && <p className="ws-err">{err}</p>}
    </div>
  );
}
