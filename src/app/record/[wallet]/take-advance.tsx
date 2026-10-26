"use client";

import { useCallback, useState } from "react";
import { Banknote, Check, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { erc20Abi, publicActions, type Address, type WalletClient } from "viem";
import { useWallet } from "@/lib/wallet/use-wallet";
import { METIS_MAINNET_CHAIN_ID, viemChainFor } from "@/lib/deputy/networks";
import { EmbeddedWalletBridge, type EmbeddedWallet } from "@/components/campaigns/embedded-wallet-bridge";

/** Whether the email door (and so an embedded wallet) exists on this deployment. */
const EMAIL_DOOR = !!process.env.NEXT_PUBLIC_PRIVY_LOGIN_APP_ID?.trim();
/** An ERC-20 approve on Metis measures ~46k gas; the pot's fee cover is sized for this ceiling (pot.ts). */
const APPROVE_GAS = BigInt(60_000);

/**
 * "TAKE AN ADVANCE", ON METIS (26 Oct 2026). Shown only to the record's owner, only when the pot can pay.
 *
 * Two steps, in this order, because the second needs the first:
 *   1. Approve repayment: one signature letting the pot collect up to the advance from the owner's next
 *      verified payouts, at most N% of each. Signed by the wallet the record belongs to: MetaMask, or the
 *      wallet an email sign-in holds. A wallet with no METIS gets this one fee covered by the pot.
 *   2. Take it: the pot sends the advance straight to the wallet.
 * The approval is read back from the chain before step 2 opens; nothing here takes the page's word for it.
 */
export function TakeAdvanceButton({
  wallet,
  offerUsd,
  multiple,
  waterfallBps,
  pot,
  token,
  approved: approvedAtLoad,
  needsFee,
}: {
  wallet: string;
  offerUsd: number;
  multiple: number;
  waterfallBps: number;
  pot: string;
  token: string;
  approved: boolean;
  needsFee: boolean;
}) {
  const injected = useWallet();
  const [embedded, setEmbedded] = useState<EmbeddedWallet | null>(null);
  const [approved, setApproved] = useState(approvedAtLoad);
  const [busy, setBusy] = useState<"fee" | "approve" | "confirming" | "take" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ usd: number; explorerUrl: string; confirming: boolean } | null>(null);
  const pct = waterfallBps / 100;
  const owner = wallet.toLowerCase();
  const api = `/api/record/${encodeURIComponent(wallet)}/advance`;

  /** The wallet this record belongs to, ready to sign on Metis: MetaMask if it is the one here, else the email account's. */
  const signer = useCallback(async (connected: string | null = injected.address): Promise<WalletClient | null> => {
    if (connected?.toLowerCase() === owner) {
      await injected.switchToChain(METIS_MAINNET_CHAIN_ID).catch(() => undefined);
      return injected.getWalletClient(METIS_MAINNET_CHAIN_ID);
    }
    if (embedded?.address.toLowerCase() === owner) return embedded.getWalletClient(METIS_MAINNET_CHAIN_ID);
    return null;
  }, [injected, embedded, owner]);

  const approve = async () => {
    setErr(null);
    try {
      if (needsFee) {
        setBusy("fee");
        const r = (await (await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ step: "fee" }) })).json()) as { ok?: boolean; error?: string };
        if (!r.ok) {
          setErr(r.error ?? "The fee could not be covered. Try again in a minute.");
          return;
        }
      }
      setBusy("approve");
      let client = await signer();
      if (!client && !injected.address && injected.available) client = await signer(await injected.connect());
      if (!client) {
        setErr("Approve from the wallet this record belongs to: connect it here (MetaMask), or sign in with the email account that holds it.");
        return;
      }
      const principal = BigInt(Math.round(offerUsd * 100)) * BigInt(10_000);
      try {
        // FULLY SPECIFIED, so no wallet fills in fees of its own: Metis rejects EIP-1559 transactions, and
        // an email sign-in's wallet (Privy) and MetaMask must both send exactly a legacy one. The gas price
        // comes from the wallet's own Metis endpoint, +20% as every Sage write on Metis.
        const gasPrice = ((await client.extend(publicActions).getGasPrice()) * BigInt(12)) / BigInt(10);
        await client.writeContract({ account: wallet as Address, address: token as Address, abi: erc20Abi, functionName: "approve", args: [pot as Address, principal], chain: viemChainFor(METIS_MAINNET_CHAIN_ID), type: "legacy", gasPrice, gas: APPROVE_GAS });
      } catch {
        setErr("The approval was not signed. Nothing changed.");
        return;
      }
      // The chain decides: read the approval back until it shows, then open step 2.
      setBusy("confirming");
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const o = (await (await fetch(api, { cache: "no-store" })).json().catch(() => null)) as { approval?: { approved?: boolean } } | null;
        if (o?.approval?.approved) {
          setApproved(true);
          return;
        }
      }
      setErr("Your approval was sent and is taking a while to confirm. Refresh this page in a minute.");
    } finally {
      setBusy(null);
    }
  };

  const take = async () => {
    setErr(null);
    setBusy("take");
    try {
      const res = await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ usd: offerUsd }) });
      const j = (await res.json()) as { ok?: boolean; error?: string; explorerUrl?: string; confirming?: boolean; usd?: number };
      if (!res.ok || !j.ok || !j.explorerUrl) setErr(j.error ?? "The advance could not be sent.");
      else setDone({ usd: j.usd ?? offerUsd, explorerUrl: j.explorerUrl, confirming: !!j.confirming });
    } catch {
      setErr("The advance could not be sent. Try again in a minute.");
    } finally {
      setBusy(null);
    }
  };

  if (done) {
    return (
      <div className="rec-take rec-take-done">
        <div className="rec-take-title">
          <Check size={14} /> ${done.usd.toFixed(2)} {done.confirming ? "is on its way to" : "is in"} your wallet
        </div>
        <span className="rec-link-hint">
          {pct}% of each of your next verified payouts on Metis repays it, collected automatically under the approval you signed.{" "}
          <a href={done.explorerUrl} target="_blank" rel="noreferrer noopener">
            The transaction <ExternalLink size={11} />
          </a>
        </span>
      </div>
    );
  }

  return (
    <div className="rec-take">
      {EMAIL_DOOR && <EmbeddedWalletBridge onChange={setEmbedded} />}
      <ol className="rec-take-steps">
        <li className={approved ? "done" : "on"}>
          <button type="button" className="rec-link-btn" disabled={approved || busy !== null} onClick={() => void approve()}>
            {approved ? <Check size={14} /> : busy && busy !== "take" ? <Loader2 size={14} className="sage-spin2" /> : <ShieldCheck size={14} />}{" "}
            {approved ? "Repayment approved" : busy === "fee" ? "Covering the fee…" : busy === "approve" ? "Approve in your wallet…" : busy === "confirming" ? "Confirming on Metis…" : "1. Approve repayment"}
          </button>
          {!approved && (
            <span className="rec-link-hint">
              Lets the pot collect up to ${offerUsd.toFixed(2)} from your next verified payouts on Metis, {pct}% of each. One signature
              {needsFee ? "; the pot covers its network fee" : ", a fraction of a cent in METIS"}.
            </span>
          )}
        </li>
        <li className={approved ? "on" : ""}>
          <button type="button" className="rec-link-btn" disabled={!approved || busy !== null} onClick={() => void take()}>
            {busy === "take" ? <Loader2 size={14} className="sage-spin2" /> : <Banknote size={14} />} {busy === "take" ? "Sending…" : `2. Take $${offerUsd.toFixed(2)}`}
          </button>
        </li>
      </ol>
      <span className="rec-link-hint">
        {multiple}× your verified monthly inflow, up to what the pot holds. Sent straight to your wallet on Metis; no application, no
        interest, and nothing to repay by hand. The lender today is Sage&apos;s own pot.
      </span>
      {err && <span className="rec-link-err">{err}</span>}
    </div>
  );
}
