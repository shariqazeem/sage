"use client";

import { useState } from "react";
import { ArrowUpRight, Check, Loader2 } from "lucide-react";

import { EmbeddedWalletBridge, type EmbeddedWallet } from "@/components/campaigns/embedded-wallet-bridge";
import { Button, ButtonLink } from "@/components/sage/button";
import { usePayFromWallet } from "./use-pay-from-wallet";
import type { StepView } from "@/lib/own-wallet/run";

const emailDoor = (): boolean => !!process.env.NEXT_PUBLIC_PRIVY_LOGIN_APP_ID?.trim();

const STATUS_WORDS: Record<StepView["status"], string> = {
  waiting: "Next",
  sign: "Confirm in your wallet",
  confirming: "Confirming on Metis",
  done: "Done",
  failed: "Not sent",
};

/**
 * PAY FROM YOUR WALLET: the plain face of `usePayFromWallet`. One sentence, the four steps with their
 * transaction links, what the wallet is short of (if anything), and one button. It is drawn with the
 * interface kit only (`Button`, `ButtonLink` and the classes in `sage.css`); a page that wants another
 * look draws the hook's state itself.
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
      <div className="sg-stack sg-gap-3">
        {bridge}
        <p className="sg-small"><Loader2 size={14} className="sg-spin" aria-hidden /> Checking your wallet…</p>
      </div>
    );
  }

  if (pay.phase === "signed-out") {
    return (
      <div className="sg-stack sg-gap-3">
        {bridge}
        <p className="sg-text">Sign in with your email or MetaMask to pay for this test from your own wallet on Metis.</p>
        <Button onClick={() => window.location.assign(`/start?next=${encodeURIComponent(window.location.pathname)}`)}>Sign in to pay</Button>
      </div>
    );
  }

  const steps = (
    <div className="sg-sum" role="list" aria-label="Launch steps">
      {pay.steps.map((s) => (
        <div key={s.step} className="sg-sum-row" role="listitem">
          <span>
            {s.status === "done" && <Check size={13} aria-hidden />} {s.label}
          </span>
          {s.explorerUrl ? (
            <a className="sg-link sg-small" href={s.explorerUrl} target="_blank" rel="noreferrer" aria-label={`${s.label}: ${STATUS_WORDS[s.status]}, view transaction`}>
              {STATUS_WORDS[s.status]} <ArrowUpRight size={13} aria-hidden />
            </a>
          ) : (
            <span className="sg-small">{STATUS_WORDS[s.status]}</span>
          )}
        </div>
      ))}
    </div>
  );

  if (pay.phase === "live") {
    return (
      <div className="sg-stack sg-gap-3">
        {bridge}
        <p className="sg-text sg-ink">Paid from your wallet. The vault is funded and active on Metis, and the test is live.</p>
        {pay.steps.some((s) => s.explorerUrl) && steps}
        {pay.campaignId && <ButtonLink href={`/t/${pay.campaignId}`}>Open the test</ButtonLink>}
      </div>
    );
  }

  return (
    <div className="sg-stack sg-gap-3" aria-label="Pay from your wallet">
      {bridge}
      <p className="sg-text">
        {pay.balances ? (
          <>Your wallet on Metis holds <span className="sg-n">${pay.balances.usdc.toFixed(2)} m.USDC</span> and <span className="sg-n">{pay.balances.metis} METIS</span>.</>
        ) : (
          "Pay for this test from your own wallet on Metis."
        )}
        {usd && pay.phase !== "refused" ? ` This test needs ${usd}. It goes into the test's own vault, and what isn't spent comes back to your wallet.` : ""}
      </p>

      {(started || pay.busy) && steps}

      {pay.phase === "recording" && (
        <p className="sg-small" role="status"><Loader2 size={14} className="sg-spin" aria-hidden /> Sage is checking the vault on Metis…</p>
      )}

      {pay.shortfalls.map((s) => (
        <p key={s.what} className="sg-small sg-note-problem">{s.message}</p>
      ))}

      {pay.phase !== "refused" && pay.phase !== "stopped" &&
        (pay.phase === "short" ? (
          <Button variant="quiet" onClick={() => void pay.refresh()} disabled={pay.busy}>Check my wallet again</Button>
        ) : (
          <Button onClick={() => void pay.pay()} disabled={pay.busy || !!hold}>
            {pay.busy ? "Working…" : started ? "Continue" : usd ? `Pay ${usd} from your wallet` : "Pay from your wallet"}
          </Button>
        ))}

      {pay.owner && pay.phase !== "refused" && <p className="sg-small sg-mono">{pay.owner.slice(0, 6)}…{pay.owner.slice(-4)} on Metis</p>}
      {hold && <p className="sg-small">{hold}</p>}
      {pay.error && <p className="sg-small sg-note-problem" role="alert">{pay.error}</p>}
      {pay.upgradeTo !== undefined && <ButtonLink href={pay.upgradeTo ? `/pricing?plan=${pay.upgradeTo}` : "/pricing"} variant="quiet" size="sm">See plans</ButtonLink>}
    </div>
  );
}
