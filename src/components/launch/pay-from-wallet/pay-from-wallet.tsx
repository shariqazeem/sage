"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Loader2, Wallet } from "lucide-react";

import { EmbeddedWalletBridge, type EmbeddedWallet } from "@/components/campaigns/embedded-wallet-bridge";
import { UpgradeLink } from "@/components/plans/upgrade-link";
import { usePayFromWallet } from "./use-pay-from-wallet";

const emailDoor = (): boolean => !!process.env.NEXT_PUBLIC_PRIVY_LOGIN_APP_ID?.trim();

/**
 * PAY FROM YOUR WALLET: the plain face of `usePayFromWallet`. One sentence, the four steps with their
 * transaction links, what the wallet is short of (if anything), and one button. Existing classes only
 * (the launch and workspace sheets), so a page can restyle it by drawing the hook's state itself.
 */
export function PayFromWallet({
  jobId,
  revision,
  hold,
  onLive,
}: {
  jobId: string;
  /** the plan revision on screen: paying approves this one */
  revision?: number;
  /** a reason the plan cannot launch yet; the button waits */
  hold?: string | null;
  onLive?: (campaignId: string) => void;
}) {
  const [embedded, setEmbedded] = useState<EmbeddedWallet | null>(null);
  const pay = usePayFromWallet({ jobId, revision, embedded, onLive });
  const usd = pay.budgetUsd === null ? null : `$${pay.budgetUsd.toFixed(2)}`;
  const started = pay.steps.some((s) => s.status !== "waiting");
  const bridge = emailDoor() ? <EmbeddedWalletBridge onChange={setEmbedded} /> : null;

  if (pay.phase === "loading") {
    return (
      <p className="lx-sub tl-gap">
        {bridge}
        <Loader2 size={14} className="sage-spin2" /> Checking your wallet…
      </p>
    );
  }

  if (pay.phase === "signed-out") {
    return (
      <div className="lxd-panel tl-gap">
        {bridge}
        <p className="lx-sub"><Wallet size={14} /> Sign in with your email or MetaMask to pay for this test from your own wallet on Metis.</p>
        <div className="ws-nav">
          <button className="lx-btn" onClick={() => window.location.assign(`/start?next=${encodeURIComponent(window.location.pathname)}`)}>Sign in to pay</button>
        </div>
      </div>
    );
  }

  if (pay.phase === "live") {
    return (
      <div className="lxd-panel tl-gap">
        {bridge}
        <p className="lx-sub"><Check size={14} /> Paid from your wallet. The vault is funded and active on Metis, and the test is live.</p>
        <div className="ws-nav tl-top">
          {pay.campaignId && <Link className="sage-btn sage-btn-primary sage-btn-sm" href={`/campaign/${pay.campaignId}`}>Open it <ArrowUpRight size={13} /></Link>}
          {pay.steps.filter((s) => s.explorerUrl).map((s) => (
            <a key={s.step} className="ws-chip" href={s.explorerUrl ?? undefined} target="_blank" rel="noopener noreferrer">{s.step} tx</a>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="lxd-panel tl-gap" aria-label="Pay from your wallet">
      {bridge}
      <p className="lx-sub">
        <Wallet size={14} />{" "}
        {pay.balances
          ? `Your wallet on Metis holds $${pay.balances.usdc.toFixed(2)} m.USDC and ${pay.balances.metis} METIS.`
          : "Pay for this test from your own wallet on Metis."}
        {usd && pay.phase !== "refused" ? ` This test needs ${usd}, which goes into its own vault; what it doesn't spend comes back to your wallet.` : ""}
      </p>

      {(started || pay.busy) && (
        <ol className="lxd-steps" aria-label="Launch steps">
          {pay.steps.map((s, i) => (
            <li key={s.step} className={`lxd-step ${s.status === "done" ? "done" : ""} ${s.status === "sign" || s.status === "confirming" ? "active" : ""}`}>
              <span className="lxd-step-dot" aria-hidden>{s.status === "done" ? <Check size={11} /> : i + 1}</span>
              <span className="lxd-step-label">
                {s.label}
                {s.status === "sign" ? ": confirm in your wallet" : s.status === "confirming" ? ": confirming on Metis" : s.status === "failed" ? ": not sent" : ""}
              </span>
              {s.explorerUrl && <a className="ws-chip" href={s.explorerUrl} target="_blank" rel="noopener noreferrer">tx</a>}
            </li>
          ))}
        </ol>
      )}

      {pay.phase === "recording" && (
        <p className="lxd-note" role="status"><span className="lxd-spin" aria-hidden /> Sage is checking the vault on Metis…</p>
      )}

      {pay.shortfalls.map((s) => (
        <p key={s.what} className="ws-note">{s.message}</p>
      ))}

      {pay.phase !== "refused" && pay.phase !== "stopped" && (
        <div className="ws-nav">
          {pay.phase === "short" ? (
            <button className="lx-btn" onClick={() => void pay.refresh()} disabled={pay.busy}>I&apos;ve added it, check again</button>
          ) : (
            <button className="lx-btn" onClick={() => void pay.pay()} disabled={pay.busy || !!hold}>
              {pay.busy ? (
                <><Loader2 size={13} className="sage-spin2" /> Working…</>
              ) : started ? (
                "Continue"
              ) : (
                `Pay ${usd ?? ""} from your wallet`.replace("  ", " ")
              )}
            </button>
          )}
          {pay.owner && <span className="ws-note tl-flat mono">{pay.owner.slice(0, 6)}…{pay.owner.slice(-4)} · Metis</span>}
        </div>
      )}

      {hold && <p className="ws-note">{hold}</p>}
      {pay.error && <p className="ws-err" role="alert">{pay.error}</p>}
      {pay.upgradeTo !== undefined && <div className="ws-nav"><UpgradeLink to={pay.upgradeTo} className="sage-btn sage-btn-sm" /></div>}
    </div>
  );
}
