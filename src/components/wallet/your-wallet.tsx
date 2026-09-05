"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Copy, Loader2, Wallet } from "lucide-react";
import { useWallet } from "@/lib/wallet/use-wallet";
import { EmbeddedWalletBridge, type EmbeddedWallet } from "@/components/campaigns/embedded-wallet-bridge";

/**
 * YOUR WALLET, INSIDE SAGE. Deposit is the address; withdraw is gasless — the wallet signs an
 * EIP-3009 authorization (a browser wallet through its own prompt, an email account through its
 * Privy embedded wallet) and Sage's operator submits it and pays the gas. A worker paid here holds
 * USDC on GOAT and no BTC for gas, so without this they could receive money and never move it.
 */
type Balance = { address: string; network: string; usd: number; usdcBase: string; explorerUrl: string };
type Prepared = {
  amountBase: string;
  validBefore: number;
  nonce: `0x${string}`;
  typedData: {
    domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
    types: Record<string, { name: string; type: string }[]>;
    primaryType: "TransferWithAuthorization";
    message: { from: `0x${string}`; to: `0x${string}`; value: string; validAfter: string; validBefore: string; nonce: `0x${string}` };
  };
};

const emailDoor = (): boolean => !!process.env.NEXT_PUBLIC_PRIVY_LOGIN_APP_ID?.trim();

export function YourWallet({ address }: { address: string }) {
  const injected = useWallet();
  const [embedded, setEmbedded] = useState<EmbeddedWallet | null>(null);
  const [bal, setBal] = useState<Balance | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<"idle" | "preparing" | "signing" | "sending">("idle");
  const [sent, setSent] = useState<{ txHash: string; explorerTx: string; amountUsd: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/wallet", { cache: "no-store" });
      const j = (await r.json()) as Balance & { ok: boolean; error?: string };
      if (r.ok && j.ok) setBal(j);
      else setErr(j.error ?? "could not read the balance");
    } catch {
      setErr("could not read the balance");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const same = (a?: string | null) => !!a && a.toLowerCase() === address.toLowerCase();

  const withdraw = async () => {
    setErr(null); setSent(null);
    const usd = Number(amount);
    if (!/^0x[0-9a-fA-F]{40}$/.test(to.trim())) { setErr("Give an Ethereum address to send to."); return; }
    if (!Number.isFinite(usd) || usd <= 0) { setErr("Give an amount in USDC."); return; }
    try {
      setPhase("preparing");
      const p = await fetch("/api/wallet/withdraw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "prepare", to: to.trim(), amountUsd: usd }) });
      const prep = (await p.json()) as Prepared & { ok: boolean; error?: string };
      if (!p.ok || !prep.ok) throw new Error(prep.error ?? "could not prepare the withdrawal");
      setPhase("signing");
      const typed = {
        domain: prep.typedData.domain,
        types: prep.typedData.types,
        primaryType: prep.typedData.primaryType,
        message: { ...prep.typedData.message, value: BigInt(prep.typedData.message.value), validAfter: BigInt(prep.typedData.message.validAfter), validBefore: BigInt(prep.typedData.message.validBefore) },
      };
      let signature: `0x${string}` | null = null;
      if (same(injected.address)) {
        const client = injected.getWalletClient(prep.typedData.domain.chainId);
        if (!client) throw new Error("Reconnect your wallet to sign.");
        signature = await client.signTypedData({ account: address as `0x${string}`, ...typed });
      } else if (same(embedded?.address)) {
        const client = await embedded!.getWalletClient();
        if (!client) throw new Error("Your embedded wallet is not ready — try again.");
        signature = await client.signTypedData({ account: address as `0x${string}`, ...typed });
      } else {
        throw new Error("Sign in with this wallet to withdraw from it.");
      }
      setPhase("sending");
      const s = await fetch("/api/wallet/withdraw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "submit", to: to.trim(), amountBase: prep.amountBase, validBefore: prep.validBefore, nonce: prep.nonce, signature }) });
      const done = (await s.json()) as { ok: boolean; error?: string; txHash: string; explorerTx: string; amountUsd: number };
      if (!s.ok || !done.ok) throw new Error(done.error ?? "the withdrawal was not sent");
      setSent({ txHash: done.txHash, explorerTx: done.explorerTx, amountUsd: done.amountUsd });
      setAmount("");
      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "the withdrawal failed");
    } finally {
      setPhase("idle");
    }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };

  return (
    <section className="yw" aria-label="Your wallet">
      {emailDoor() && <EmbeddedWalletBridge onChange={setEmbedded} />}
      <div className="yw-h">
        <h2><Wallet size={15} /> Your wallet</h2>
        <span className="yw-net mono">{bal?.network ?? "GOAT Network"} · USDC</span>
      </div>
      <div className="yw-grid">
        <div>
          <p className="yw-k">Deposit — send USDC on {bal?.network ?? "GOAT Network"} to</p>
          <p className="yw-addr"><span className="mono">{address}</span> <button type="button" className="yw-copy" onClick={() => void copy()} aria-label="Copy address"><Copy size={13} /> {copied ? "Copied" : "Copy"}</button></p>
        </div>
        <div>
          <p className="yw-k">Balance</p>
          <p className="yw-bal mono">{bal ? `$${bal.usd.toFixed(2)}` : "…"}</p>
          {bal && <a className="yw-link" href={bal.explorerUrl} target="_blank" rel="noopener noreferrer">on the explorer <ArrowUpRight size={12} /></a>}
        </div>
      </div>
      <div className="yw-form">
        <p className="yw-k">Withdraw — gasless. You sign; Sage pays the gas.</p>
        <div className="yw-row">
          <input className="sage-input mono" placeholder="0x… address to send to" value={to} onChange={(e) => setTo(e.target.value)} />
          <input className="sage-input mono yw-amt" placeholder="USDC" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button type="button" className="sage-btn sage-btn-sm" onClick={() => setAmount(bal ? bal.usd.toFixed(2) : "")} disabled={!bal || bal.usd <= 0}>All</button>
          <button type="button" className="sage-btn sage-btn-primary sage-btn-sm" onClick={() => void withdraw()} disabled={phase !== "idle" || !bal || bal.usd <= 0}>
            {phase === "idle" ? "Withdraw" : <><Loader2 size={13} className="sage-spin2" /> {phase === "preparing" ? "Preparing…" : phase === "signing" ? "Sign in your wallet…" : "Sending…"}</>}
          </button>
        </div>
        {err && <p className="yw-err">{err}</p>}
        {sent && <p className="yw-ok">Sent ${sent.amountUsd.toFixed(2)} · <a href={sent.explorerTx} target="_blank" rel="noopener noreferrer" className="mono">{sent.txHash.slice(0, 10)}…</a></p>}
      </div>
    </section>
  );
}
