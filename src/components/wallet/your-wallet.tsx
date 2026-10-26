"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Copy, Loader2, Wallet } from "lucide-react";
import { erc20Abi, publicActions, type WalletClient } from "viem";
import { useWallet } from "@/lib/wallet/use-wallet";
import { EmbeddedWalletBridge, type EmbeddedWallet } from "@/components/campaigns/embedded-wallet-bridge";
import { chainConfig, METIS_MAINNET_CHAIN_ID, viemChainFor } from "@/lib/deputy/networks";
import { needsFeeMessage, TRANSFER_GAS_UNITS } from "@/lib/treasury/gas-policy";

/**
 * YOUR WALLET, INSIDE SAGE. Deposit is the address. A withdrawal leaves the way the network's USDC
 * allows, and the same for an email sign-in (its Privy wallet) and MetaMask:
 * - GOAT's USDC takes a signed transfer (EIP-3009): the wallet signs and Sage's operator sends it and
 *   pays the gas, so a worker paid there with no BTC can still move it.
 * - Metis m.USDC takes no signature (measured 26 Oct 2026), so on Metis the wallet sends its own
 *   transfer and pays its own small METIS fee, as every account on Metis does. Short of METIS, it says
 *   how much and where to get it, and sends nothing.
 *
 * IT ASKS EVERY RAIL, because a worker does not choose which chain paid them — the campaign did.
 * This panel once read one chain and printed $0.00 to a worker whose dollar sat on another (measured
 * 2026-09-13). Metis is always shown, as the network Sage runs on; GOAT and Arc only when they hold
 * money, and then only to withdraw it, since nothing new starts there.
 */
type Balance = {
  address: string;
  network: string;
  usd: number;
  usdcBase: string;
  explorerUrl: string;
  chainId: number;
  token: `0x${string}`;
  gasless: boolean;
  nativeSymbol: string;
  nativeWei: string;
  feeWei: string;
  legacyGas: boolean;
  paused: boolean;
};
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

/** The EVM networks a worker can have been paid on, the one Sage runs on first. A payout's chain is the campaign's, never the worker's choice. */
const RAILS = [METIS_MAINNET_CHAIN_ID, 2345, 5042] as const;

export function YourWallet({ address }: { address: string }) {
  const injected = useWallet();
  const [embedded, setEmbedded] = useState<EmbeddedWallet | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [chainId, setChainId] = useState<number | null>(null);
  const bal = balances.find((b) => b.chainId === chainId) ?? null;
  const [err, setErr] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<"idle" | "preparing" | "signing" | "sending">("idle");
  const [sent, setSent] = useState<{ txHash: string; explorerTx: string; amountUsd: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = await Promise.all(
        RAILS.map(async (id) => {
          try {
            const r = await fetch(`/api/wallet?chainId=${id}`, { cache: "no-store" });
            const j = (await r.json()) as Omit<Balance, "chainId"> & { ok: boolean; error?: string };
            if (!r.ok || !j.ok) return null;
            const one: Balance = { ...j, chainId: id };
            return one;
          } catch {
            return null;
          }
        }),
      );
      // Metis always; a paused or closed network only while it still holds this wallet's money.
      const live = found.filter((b): b is Balance => b !== null && (b.chainId === METIS_MAINNET_CHAIN_ID || b.usd > 0));
      if (live.length === 0) {
        setErr("could not read the balance");
        return;
      }
      setBalances(live);
      // Land on the rail that actually holds money; else Metis.
      setChainId((current) => current ?? (live.find((b) => b.usd > 0) ?? live[0]).chainId);
    } catch {
      setErr("could not read the balance");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const same = (a?: string | null) => !!a && a.toLowerCase() === address.toLowerCase();

  /** The wallet this balance belongs to, ready on its chain: MetaMask if it is the one here, else the email account's own. */
  const signerOn = async (id: number): Promise<WalletClient> => {
    if (same(injected.address)) {
      if (!injected.onChain(id)) await injected.switchToChain(id);
      const client = injected.getWalletClient(id);
      if (!client) throw new Error("Reconnect your wallet to sign.");
      return client;
    }
    if (same(embedded?.address)) {
      const client = await embedded!.getWalletClient(id);
      if (!client) throw new Error("Your email account's wallet isn't ready yet. Try again in a moment.");
      return client;
    }
    throw new Error("Sign in with this wallet to withdraw from it.");
  };

  /** GOAT: sign an EIP-3009 authorization; Sage's operator sends it and pays the gas. */
  const withdrawBySignature = async (b: Balance, usd: number) => {
    setPhase("preparing");
    const p = await fetch("/api/wallet/withdraw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "prepare", to: to.trim(), amountUsd: usd, chainId: b.chainId }) });
    const prep = (await p.json()) as Prepared & { ok: boolean; error?: string };
    if (!p.ok || !prep.ok) throw new Error(prep.error ?? "could not prepare the withdrawal");
    setPhase("signing");
    const typed = {
      domain: prep.typedData.domain,
      types: prep.typedData.types,
      primaryType: prep.typedData.primaryType,
      message: { ...prep.typedData.message, value: BigInt(prep.typedData.message.value), validAfter: BigInt(prep.typedData.message.validAfter), validBefore: BigInt(prep.typedData.message.validBefore) },
    };
    const client = await signerOn(prep.typedData.domain.chainId);
    const signature = await client.signTypedData({ account: address as `0x${string}`, ...typed });
    setPhase("sending");
    const s = await fetch("/api/wallet/withdraw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "submit", to: to.trim(), amountBase: prep.amountBase, validBefore: prep.validBefore, nonce: prep.nonce, signature, chainId: b.chainId }) });
    const done = (await s.json()) as { ok: boolean; error?: string; txHash: string; explorerTx: string; amountUsd: number };
    if (!s.ok || !done.ok) throw new Error(done.error ?? "the withdrawal was not sent");
    return { txHash: done.txHash, explorerTx: done.explorerTx, amountUsd: done.amountUsd };
  };

  /** Metis (and any USDC without signed transfers): the wallet sends its own transfer and pays its own fee. */
  const withdrawFromWallet = async (b: Balance, amountBase: bigint) => {
    const need = BigInt(b.feeWei);
    const have = BigInt(b.nativeWei);
    if (have < need) throw new Error(needsFeeMessage({ chainId: b.chainId, action: "withdrawal", needWei: need, haveWei: have, nativeSymbol: b.nativeSymbol, network: b.network }));
    setPhase("signing");
    const client = await signerOn(b.chainId);
    // FULLY SPECIFIED, so neither MetaMask nor the email account's wallet fills in fees of its own:
    // Metis rejects EIP-1559, and both must send exactly a legacy transaction, priced +20% like every
    // Sage write on Metis, at the gas limit the fee above was sized for.
    const gasPrice = b.legacyGas ? ((await client.extend(publicActions).getGasPrice()) * BigInt(12)) / BigInt(10) : undefined;
    const txHash = await client.writeContract({
      account: address as `0x${string}`,
      chain: viemChainFor(b.chainId),
      address: b.token,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to.trim() as `0x${string}`, amountBase],
      gas: TRANSFER_GAS_UNITS,
      ...(b.legacyGas ? { type: "legacy" as const, gasPrice } : {}),
    });
    return { txHash, explorerTx: `${chainConfig(b.chainId).explorerUrl}/tx/${txHash}`, amountUsd: Number(amountBase) / 1_000_000 };
  };

  const withdraw = async () => {
    setErr(null); setSent(null);
    const usd = Number(amount);
    if (!/^0x[0-9a-fA-F]{40}$/.test(to.trim())) { setErr("Give an Ethereum address to send to."); return; }
    if (to.trim().toLowerCase() === address.toLowerCase()) { setErr("That is this wallet; give the address you want the money in."); return; }
    if (!Number.isFinite(usd) || usd <= 0) { setErr("Give an amount in USDC."); return; }
    if (!bal) return;
    const amountBase = BigInt(Math.round(usd * 1_000_000));
    if (amountBase > BigInt(bal.usdcBase)) { setErr(`This wallet holds $${bal.usd.toFixed(2)} on ${bal.network}.`); return; }
    try {
      const done = bal.gasless ? await withdrawBySignature(bal, usd) : await withdrawFromWallet(bal, amountBase);
      setSent(done);
      setAmount("");
      // the chain needs a moment to show the new balance
      setTimeout(() => void load(), 4000);
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : "the withdrawal failed");
    } finally {
      setPhase("idle");
    }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };

  const network = bal?.network ?? chainConfig(METIS_MAINNET_CHAIN_ID).name;
  return (
    <section className="yw" aria-label="Your wallet">
      {emailDoor() && <EmbeddedWalletBridge onChange={setEmbedded} />}
      <div className="yw-h">
        <h2><Wallet size={15} /> Your wallet</h2>
        {balances.length > 1 ? (
          <span className="yw-rails">
            {balances.map((b) => (
              <button
                key={b.chainId}
                type="button"
                className={`yw-rail${b.chainId === chainId ? " on" : ""}`}
                onClick={() => setChainId(b.chainId)}
              >
                {chainConfig(b.chainId).chipLabel} <span className="mono">${b.usd.toFixed(2)}</span>
              </button>
            ))}
          </span>
        ) : (
          <span className="yw-net mono">{network} · USDC</span>
        )}
      </div>
      <div className="yw-grid">
        <div>
          {bal?.paused ? (
            <p className="yw-k">{network} is paused for new money. What&apos;s here stays yours: withdraw it below.</p>
          ) : (
            <p className="yw-k">Deposit — send USDC on {network} to</p>
          )}
          <p className="yw-addr"><span className="mono">{address}</span> <button type="button" className="yw-copy" onClick={() => void copy()} aria-label="Copy address"><Copy size={13} /> {copied ? "Copied" : "Copy"}</button></p>
        </div>
        <div>
          <p className="yw-k">Balance</p>
          <p className="yw-bal mono">{bal ? `$${bal.usd.toFixed(2)}` : "…"}</p>
          {bal && <a className="yw-link" href={bal.explorerUrl} target="_blank" rel="noopener noreferrer">on the explorer <ArrowUpRight size={12} /></a>}
        </div>
      </div>
      <div className="yw-form">
        <p className="yw-k">
          {!bal || bal.gasless
            ? "Withdraw — gasless. You sign; Sage pays the gas."
            : `Withdraw — sent from your wallet, which pays a network fee of under a cent in ${bal.nativeSymbol}.`}
        </p>
        <div className="yw-row">
          <input className="sage-input mono" placeholder="0x… address to send to" value={to} onChange={(e) => setTo(e.target.value)} />
          <input className="sage-input mono yw-amt" placeholder="USDC" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button type="button" className="sage-btn sage-btn-sm" onClick={() => setAmount(bal ? (Math.floor(bal.usd * 100) / 100).toFixed(2) : "")} disabled={!bal || bal.usd <= 0}>All</button>
          <button type="button" className="sage-btn sage-btn-primary sage-btn-sm" onClick={() => void withdraw()} disabled={phase !== "idle" || !bal || bal.usd <= 0}>
            {phase === "idle" ? "Withdraw" : <><Loader2 size={13} className="sage-spin2" /> {phase === "preparing" ? "Preparing…" : phase === "signing" ? "Confirm in your wallet…" : "Sending…"}</>}
          </button>
        </div>
        {err && <p className="yw-err">{err}</p>}
        {sent && <p className="yw-ok">Sent ${sent.amountUsd.toFixed(2)} · <a href={sent.explorerTx} target="_blank" rel="noopener noreferrer" className="mono">{sent.txHash.slice(0, 10)}…</a></p>}
      </div>
    </section>
  );
}
