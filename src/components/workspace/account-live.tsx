"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2 } from "lucide-react";

/** The balance, live: the page re-reads it every few seconds so a deposit shows up when it lands. */
export function AccountBalance({ initialUsd, network }: { initialUsd: number; network: string }) {
  const [usd, setUsd] = useState(initialUsd);
  const router = useRouter();
  useEffect(() => {
    let live = true;
    const read = async () => {
      try {
        const r = await fetch("/api/treasury", { cache: "no-store" });
        const j = (await r.json()) as { balanceUsd?: number };
        if (live && typeof j.balanceUsd === "number" && j.balanceUsd !== usd) { setUsd(j.balanceUsd); router.refresh(); }
      } catch { /* next tick */ }
    };
    const t = setInterval(read, 8000);
    return () => { live = false; clearInterval(t); };
  }, [usd, router]);
  return (
    <div className="ac-balance">
      <span className="ac-balance-n mono">{usd.toFixed(2)}</span>
      <span className="ac-balance-u">USDC on {network}</span>
    </div>
  );
}

export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* nothing to do */ }
  };
  return (
    <button className="ws-chip" onClick={copy}>{copied ? <><Check size={11} /> copied</> : <><Copy size={11} /> copy</>}</button>
  );
}

/** Withdraw to any address: type it, see exactly what will move, confirm, get the transaction. */
export function WithdrawForm({ balanceUsd, network }: { balanceUsd: number; network: string }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<"edit" | "confirm" | "sending" | "done">("edit");
  const [result, setResult] = useState<{ txHash: string; explorerUrl: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const usd = Number(amount);
  const valid = /^0x[0-9a-fA-F]{40}$/.test(to.trim()) && Number.isFinite(usd) && usd > 0 && usd <= balanceUsd + 1e-9;
  const send = async () => {
    setStage("sending");
    setErr(null);
    try {
      const r = await fetch("/api/treasury/withdraw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: to.trim(), amountUsd: usd }) });
      const j = (await r.json()) as { ok?: boolean; txHash?: string; explorerUrl?: string; error?: string };
      if (j.ok && j.txHash && j.explorerUrl) { setResult({ txHash: j.txHash, explorerUrl: j.explorerUrl }); setStage("done"); router.refresh(); }
      else { setErr(j.error ?? "That did not go through."); setStage("edit"); }
    } catch {
      setErr("Could not reach Sage.");
      setStage("edit");
    }
  };
  if (stage === "done" && result) {
    return (
      <div className="ac-withdraw">
        <p className="ws-note" style={{ margin: 0 }}>Sent {usd.toFixed(2)} USDC to <span className="mono">{to.slice(0, 6)}…{to.slice(-4)}</span> on {network}. <a href={result.explorerUrl} target="_blank" rel="noreferrer">transaction ↗</a></p>
        <button className="sage-btn sage-btn-sm" onClick={() => { setStage("edit"); setTo(""); setAmount(""); setResult(null); }}>Withdraw again</button>
      </div>
    );
  }
  return (
    <div className="ac-withdraw">
      <input className="ws-input mono" placeholder="0x… any address on this chain" value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} disabled={stage !== "edit"} aria-label="Send to" />
      <div className="ac-withdraw-row">
        <input className="ws-input mono" type="number" min="0.01" step="0.01" placeholder="amount in USDC" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={stage !== "edit"} aria-label="Amount in USDC" />
        <button className="sage-btn sage-btn-sm" type="button" onClick={() => setAmount(balanceUsd.toFixed(2))} disabled={stage !== "edit"}>all</button>
      </div>
      {stage === "edit" && (
        <button className="sage-btn sage-btn-primary sage-btn-sm" disabled={!valid} onClick={() => setStage("confirm")}>Withdraw</button>
      )}
      {stage === "confirm" && (
        <div className="ac-confirm">
          <p className="ws-note" style={{ margin: 0 }}>Send <b>{usd.toFixed(2)} USDC</b> to <span className="mono">{to.trim()}</span>? The permit is for this address and this amount only, and the account re-locks to its mandate right after.</p>
          <div className="ac-withdraw-row">
            <button className="sage-btn sage-btn-primary sage-btn-sm" onClick={send}>Yes, send it</button>
            <button className="sage-btn sage-btn-sm" onClick={() => setStage("edit")}>Back</button>
          </div>
        </div>
      )}
      {stage === "sending" && <p className="ws-note" style={{ margin: 0 }}><Loader2 size={13} className="sage-spin2" /> Privy is signing inside the permit, then the chain confirms…</p>}
      {err && <p className="ws-err">{err}</p>}
    </div>
  );
}
