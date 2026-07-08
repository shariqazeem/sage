"use client";

import { useState } from "react";
import { getAddress } from "viem";
import { AlertTriangle, Loader2, Lock } from "lucide-react";
import { usd } from "@/lib/format";
import { useWallet } from "@/lib/wallet/use-wallet";
import { validateLowerCap } from "@/lib/wallet/cap";
import { lowerCap, type CapKind } from "@/lib/wallet/lower-cap";

function errMsg(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string };
  return e.shortMessage ?? e.message ?? "Transaction failed.";
}

/**
 * The per-tx / velocity cap value, plus — on the founder's OWN vault — the one
 * real mutation the contract allows: lowering it. The flow is deliberately
 * weighty (confirm step, plain "cannot be raised back") because that ceiling is
 * the enforcement story. On the demo vault (owner is not the viewer) it's a
 * read-only lock. After signing, the card re-reads the cap from chain.
 */
export function CapControl({
  kind,
  currentCap,
  vault,
  ownVault,
}: {
  kind: CapKind;
  currentCap: number;
  vault: string | null;
  ownVault: boolean;
}) {
  const wallet = useWallet();
  const [cap, setCap] = useState(currentCap);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Read-only unless the viewer owns the vault (only the owner may lower).
  if (!ownVault || !vault) {
    return (
      <div className="sage-pol-stepper">
        <span className="sage-pol-val mono">{usd(cap)}</span>
        <span className="sage-pol-lockbtn" title="Only the vault owner can lower this">
          <Lock size={12} />
        </span>
      </div>
    );
  }

  const proceed = () => {
    const v = validateLowerCap(cap, Number(value));
    if (!v.ok) {
      setErr(v.error ?? "Invalid amount.");
      return;
    }
    setErr(null);
    setConfirm(true);
  };

  const sign = async () => {
    if (!wallet.address) await wallet.connect();
    if (wallet.address && !wallet.onMetis) await wallet.switchToMetis();
    const wc = wallet.getWalletClient();
    if (!wc || !wallet.address) {
      setErr("Connect the vault owner wallet on Metis.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await lowerCap({
        wallet: wc,
        owner: wallet.address,
        vault: getAddress(vault),
        kind,
        newCapUsd: Number(value),
      });
      setCap(res.newCap);
      setOpen(false);
      setConfirm(false);
      setValue("");
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="sage-pol-stepper">
        <span className="sage-pol-val mono">{usd(cap)}</span>
        {!open && (
          <button
            className="sage-cap-lower"
            onClick={() => {
              setOpen(true);
              setConfirm(false);
              setErr(null);
              setValue("");
            }}
          >
            Lower
          </button>
        )}
      </div>

      {open && !confirm && (
        <div className="sage-cap-editor">
          <div className="sage-cap-row">
            <span className="sage-cap-prefix mono">$</span>
            <input
              className="sage-cap-input mono"
              inputMode="decimal"
              autoFocus
              placeholder={`below ${usd(cap)}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <button className="sage-btn sage-btn-primary sage-btn-sm" onClick={proceed}>
              Review
            </button>
            <button
              className="sage-btn sage-btn-ghost sage-btn-sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
          {err && (
            <div className="sage-cap-err">
              <AlertTriangle size={13} /> {err}
            </div>
          )}
        </div>
      )}

      {open && confirm && (
        <div className="sage-cap-confirm">
          <div className="sage-cap-confirm-txt">
            Lower this cap to <b className="mono">${value}</b>.{" "}
            <b>This cannot be raised back.</b> The ceiling and duration are
            immutable.
          </div>
          <div className="sage-cap-confirm-actions">
            <button
              className="sage-btn sage-btn-ghost sage-btn-sm"
              onClick={() => setConfirm(false)}
              disabled={busy}
            >
              Back
            </button>
            <button
              className="sage-btn sage-btn-primary sage-btn-sm"
              onClick={() => void sign()}
              disabled={busy}
            >
              {busy ? (
                <>
                  <Loader2 size={13} className="sage-spin2" /> Signing…
                </>
              ) : (
                "Lower cap for good"
              )}
            </button>
          </div>
          {err && (
            <div className="sage-cap-err">
              <AlertTriangle size={13} /> {err}
            </div>
          )}
        </div>
      )}
    </>
  );
}
