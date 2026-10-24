"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2 } from "lucide-react";

export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* nothing to do */ }
  };
  return (
    <button className="ws-chip" onClick={copy}>{copied ? <><Check size={11} /> copied</> : <><Copy size={11} /> copy</>}</button>
  );
}

/**
 * OPEN THE ACCOUNT on one network. The limit is the most Sage may put into any one job — the one
 * number the mandate is built from — and it can be changed later.
 */
export function OpenAccount({ chainId, network }: { chainId: number; network: string }) {
  const [cap, setCap] = useState("50");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const open = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/treasury", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ perCampaignCapUsd: Number(cap) || 50, chainId }) });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) { setErr(j.error ?? "Could not open the account."); return; }
      router.refresh();
    } catch {
      setErr("Could not reach Sage.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ac-open">
      <label className="ac-open-cap">
        <span>The most Sage may put into one job. You can change it any time.</span>
        <span className="ac-withdraw-row"><input className="ws-input mono" type="number" min="1" max="10000" step="1" value={cap} onChange={(e) => setCap(e.target.value)} disabled={busy} aria-label="Most per job, in USDC" /><span className="ac-open-unit">USDC per job</span></span>
      </label>
      <button className="sage-btn sage-btn-primary sage-btn-sm" onClick={() => void open()} disabled={busy}>
        {busy ? <><Loader2 size={13} className="sage-spin2" /> Opening…</> : `Open your account on ${network}`}
      </button>
      {err && <p className="ws-err">{err}</p>}
    </div>
  );
}

/**
 * THE LIMIT, EDITABLE IN PLACE. The account's mandate says the most Sage may put into one job;
 * changing it moves the account onto a new mandate with the new number and the same reclaim
 * address. Shown as a sentence with one control, because it is one number.
 */
export function CapEditor({ capUsd, chainId }: { capUsd: number; chainId: number }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(Math.round(capUsd)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const router = useRouter();
  const shown = saved ?? capUsd;
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/treasury", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ perCampaignCapUsd: Number(value), chainId }) });
      const j = (await r.json()) as { error?: string; perCampaignCapUsd?: number };
      if (!r.ok) { setErr(j.error ?? "Could not change the limit."); return; }
      setSaved(j.perCampaignCapUsd ?? Number(value));
      setEditing(false);
      router.refresh();
    } catch {
      setErr("Could not reach Sage.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ac-cap">
      <p className="acct-limit">
        <span className="acct-limit-v mono">${shown.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
        <span className="acct-limit-k">the most Sage may put into one job</span>
        {!editing && <button type="button" className="ac-cap-link" onClick={() => { setValue(String(Math.round(shown))); setEditing(true); }}>Change</button>}
      </p>
      {editing && (
        <div className="ac-withdraw-row acct-limit-edit">
          <input className="ws-input mono acct-limit-input" type="number" min="1" max="10000" step="1" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} aria-label="New limit per job, in USDC" />
          <span className="ac-open-unit">USDC per job</span>
          <button className="sage-btn sage-btn-primary sage-btn-sm" onClick={() => void save()} disabled={busy || !(Number(value) >= 1 && Number(value) <= 10000)}>{busy ? <><Loader2 size={13} className="sage-spin2" /> Saving…</> : "Save"}</button>
          <button className="sage-btn sage-btn-sm" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
        </div>
      )}
      {err && <p className="ws-err">{err}</p>}
    </div>
  );
}
