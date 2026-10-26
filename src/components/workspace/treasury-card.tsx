"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Landmark, Loader2 } from "lucide-react";

interface Status {
  linked: boolean;
  available?: boolean;
  reason?: "starknet" | "unconfigured" | null;
  address?: string;
  perCampaignCapUsd?: number;
  balanceUsd?: number;
  network?: string;
  nativeSymbol?: string;
  gasNative?: string | null;
  enoughGas?: boolean | null;
}

/**
 * YOUR ACCOUNT, AS A SUMMARY, for the pages that mention it beside something else (Settings,
 * Autopilot): what it holds, what its fees are paid with, the one limit, and the door to the account
 * page, where money is added, swapped and sent. One place does those things, so this card never
 * offers a second way to open or fund the account.
 */
export function TreasuryCard() {
  const [st, setSt] = useState<Status | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch("/api/treasury", { cache: "no-store" });
        const j = r.ok ? ((await r.json()) as Status) : { linked: false, available: false };
        if (live) setSt(j);
      } catch {
        if (live) setSt({ linked: false, available: false });
      }
    };
    void load();
    const t = setInterval(() => void load(), 20000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const network = st?.network ?? "Metis";
  const usdcIsGas = st?.nativeSymbol === "USDC";
  return (
    <section className="ws-card" id="account">
      <div className="ws-card-h">
        <h2><Landmark size={15} /> Your account</h2>
        {st && st.available !== false && <Link className="ws-chip" href="/workspace/account">open <ArrowRight size={11} /></Link>}
      </div>
      {st === null ? (
        <p className="ac-empty"><Loader2 size={13} className="sage-spin2" /> Reading…</p>
      ) : st.linked ? (
        <div className="tc-sum">
          <p className="acct-limit">
            <span className="acct-limit-v mono">${(st.balanceUsd ?? 0).toFixed(2)}</span>
            <span className="acct-limit-k">USDC on {network}</span>
          </p>
          <p className="ws-note tc-note">
            {usdcIsGas ? "USDC pays the network fees here too." : `${st.gasNative ? Number(st.gasNative).toFixed(4) : "—"} ${st.nativeSymbol ?? ""} for network fees${st.enoughGas === false ? ", not enough to launch a job yet" : ""}.`} Sage may put up to ${st.perCampaignCapUsd?.toFixed(2)} into any one job.
          </p>
          <Link className="sage-btn sage-btn-sm" href="/workspace/account">Add money, swap or send <ArrowRight size={13} /></Link>
        </div>
      ) : st.available === false ? (
        <p className="ac-empty">
          {st.reason === "starknet"
            ? <>The account is a wallet Sage holds for you on {network}, so it opens with an email or MetaMask sign-in. Nothing new starts on Starknet; your Starknet jobs and receipts stay as they are.</>
            : <>Accounts aren&apos;t configured on this deployment.</>}
        </p>
      ) : (
        <div className="tc-sum">
          <p className="ws-note tc-note">Sage funds every job from your account, inside a limit you set, and you add, swap and send money there.</p>
          <Link className="sage-btn sage-btn-primary sage-btn-sm" href="/workspace/account">Your account on {network} <ArrowRight size={13} /></Link>
        </div>
      )}
    </section>
  );
}
