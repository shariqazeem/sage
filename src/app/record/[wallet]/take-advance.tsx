"use client";

import { useState } from "react";
import { Banknote, Copy } from "lucide-react";

/**
 * "Take an advance" — shown only to the record's owner when self-serve is armed and the formula
 * allows something. One click: the pot escrows on Starknet and the claim link appears ONCE (bearer
 * cash). Repayment is the waterfall on the next verified payouts; nothing else is asked.
 */
export function TakeAdvanceButton({ wallet, offerUsd, multiple, waterfallBps }: { wallet: string; offerUsd: number; multiple: number; waterfallBps: number }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ claimUrl: string; disburseTx: string; usd: number } | null>(null);
  const [copied, setCopied] = useState(false);
  if (done) {
    return (
      <div className="rec-take rec-take-done">
        <div className="rec-take-title">${done.usd.toFixed(2)} is escrowed for you — collect it with this link</div>
        <div className="rec-take-claim">
          <code>{done.claimUrl}</code>
          <button type="button" className="rec-link-btn" onClick={async () => { try { await navigator.clipboard.writeText(done.claimUrl); setCopied(true); } catch { /* no clipboard */ } }}>
            <Copy size={14} /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <span className="rec-link-hint">
          This link is the money — anyone holding it can collect. It is shown once; copy it now. Escrow tx {done.disburseTx.slice(0, 10)}… ·
          {" "}{waterfallBps / 100}% of each of your next verified payouts repays it automatically until it is settled.
        </span>
      </div>
    );
  }
  return (
    <div className="rec-take">
      <button
        type="button"
        className="rec-link-btn"
        disabled={busy || offerUsd < 0.1}
        onClick={async () => {
          setBusy(true); setErr(null);
          try {
            const res = await fetch(`/api/record/${encodeURIComponent(wallet)}/advance`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ usd: offerUsd }) });
            const j = (await res.json()) as { ok?: boolean; error?: string; claimUrl?: string; disburseTx?: string; usd?: number };
            if (!res.ok || !j.ok || !j.claimUrl) setErr(j.error ?? "Could not disburse.");
            else setDone({ claimUrl: j.claimUrl, disburseTx: j.disburseTx ?? "", usd: j.usd ?? offerUsd });
          } catch { setErr("Could not disburse."); } finally { setBusy(false); }
        }}
      >
        <Banknote size={14} /> {busy ? "Escrowing…" : `Take $${offerUsd.toFixed(2)} as an advance`}
      </button>
      <span className="rec-link-hint">
        {multiple}× your verified monthly inflow, capped by the facility. Repaid by {waterfallBps / 100}% of each of your next verified
        payouts — no application, no interest schedule, nothing else to sign. The lender today is Sage&apos;s own pot.
      </span>
      {err && <span className="rec-link-err">{err}</span>}
    </div>
  );
}
