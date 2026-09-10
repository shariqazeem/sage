"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useWallet } from "@/lib/wallet/use-wallet";

/**
 * FUND FROM ANY CHAIN. USDC the founder already holds on Ethereum, Base or Arbitrum lands in their
 * Sage account on Arc through Circle's App Kit over CCTP v2: one approval and one burn signed in the
 * browser wallet, and Circle's forwarder mints on Arc into the account. The founder never needs a
 * wallet on Arc at all — the account is the wallet on Arc.
 */
type SourceChain = "Ethereum_Sepolia" | "Base_Sepolia" | "Arbitrum_Sepolia" | "Ethereum" | "Base" | "Arbitrum";
const TESTNET_SOURCES: { id: SourceChain; label: string }[] = [
  { id: "Base_Sepolia", label: "Base Sepolia" },
  { id: "Ethereum_Sepolia", label: "Ethereum Sepolia" },
  { id: "Arbitrum_Sepolia", label: "Arbitrum Sepolia" },
];
const MAINNET_SOURCES: { id: SourceChain; label: string }[] = [
  { id: "Base", label: "Base" },
  { id: "Ethereum", label: "Ethereum" },
  { id: "Arbitrum", label: "Arbitrum" },
];

type Step = { key: string; text: string; state: "pending" | "success" | "error"; url?: string };

// The kit names Arc testnet today; Arc mainnet joins its enum with the mainnet release (16 Sep).
export function BridgeIn({ account, destinationChain, testnet }: { account: string; destinationChain: "Arc_Testnet"; testnet: boolean }) {
  const wallet = useWallet();
  const router = useRouter();
  const sources = testnet ? TESTNET_SOURCES : MAINNET_SOURCES;
  const [source, setSource] = useState<SourceChain>(sources[0].id);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ sourceUrl?: string } | null>(null);
  const kitRef = useRef<Promise<typeof import("@circle-fin/app-kit")> | null>(null);
  const adapterModRef = useRef<Promise<typeof import("@circle-fin/adapter-viem-v2")> | null>(null);

  // warm the SDK while the founder reads the page; the click then starts at once
  useEffect(() => {
    kitRef.current = import("@circle-fin/app-kit");
    adapterModRef.current = import("@circle-fin/adapter-viem-v2");
  }, []);

  const valid = useMemo(() => Number.isFinite(Number(amount)) && Number(amount) > 0, [amount]);

  const bridge = async () => {
    setErr(null);
    setDone(null);
    setSteps([]);
    if (!wallet.address) {
      await wallet.connect();
      return;
    }
    const provider = wallet.getProvider();
    if (!provider) { setErr("No browser wallet found. Install one, or send USDC straight to the address above."); return; }
    setBusy(true);
    try {
      const [{ AppKit }, { createViemAdapterFromProvider }] = await Promise.all([kitRef.current ?? import("@circle-fin/app-kit"), adapterModRef.current ?? import("@circle-fin/adapter-viem-v2")]);
      const adapter = await createViemAdapterFromProvider({ provider });
      const kit = new AppKit();
      kit.on("*", (payload: unknown) => {
        const p = payload as { action?: string; state?: string; txHash?: string; explorerUrl?: string; message?: string; type?: string };
        const key = p.action ?? p.type ?? "step";
        const state: Step["state"] = p.state === "error" ? "error" : p.state === "success" ? "success" : "pending";
        setSteps((xs) => {
          const text = `${key.replace(/[._]/g, " ")}${p.message ? ` — ${p.message}` : ""}`;
          const i = xs.findIndex((s) => s.key === key);
          const next: Step = { key, text, state, url: p.explorerUrl };
          return i >= 0 ? xs.map((s, j) => (j === i ? next : s)) : [...xs, next];
        });
      });
      const run = () => kit.bridge({
        from: { adapter, chain: source },
        to: { chain: destinationChain, recipientAddress: account, useForwarder: true },
        amount: Number(amount).toFixed(2),
        config: { transferSpeed: "FAST" },
      });
      let result = await run();
      if (result.state === "error") {
        // one retry: the SDK resumes from the failed step (attestation waits, a dropped RPC)
        try { result = await kit.retryBridge(result, { from: adapter }); } catch { /* reported below */ }
      }
      if (result.state !== "success") {
        const failed = (result.steps ?? []).find((s) => s.state === "error");
        throw new Error(failed?.errorMessage ?? "The bridge did not complete.");
      }
      const burn = (result.steps ?? []).find((s) => s.explorerUrl && /burn|deposit/i.test(s.name ?? ""));
      setDone({ sourceUrl: burn?.explorerUrl ?? (result.steps ?? []).find((s) => s.explorerUrl)?.explorerUrl });
      setAmount("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : "The bridge did not complete.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bi">
      <p className="bi-lede">Have USDC on another chain? Bridge it straight into this account. One approval and one burn in your wallet; Circle mints it on Arc, into the account, no wallet on Arc needed.</p>
      <div className="bi-row">
        <select className="ws-input" value={source} onChange={(e) => setSource(e.target.value as SourceChain)} disabled={busy} aria-label="From chain">
          {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <input className="ws-input mono" type="number" min="0.01" step="0.01" placeholder="USDC" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} aria-label="Amount in USDC" />
        <button className="sage-btn sage-btn-primary sage-btn-sm" onClick={bridge} disabled={busy || (!!wallet.address && !valid) || !wallet.available}>
          {busy ? <><Loader2 size={13} className="sage-spin2" /> Bridging…</> : wallet.address ? "Bridge to my account" : "Connect wallet"}
        </button>
      </div>
      {wallet.address ? <p className="bi-fine">From <span className="mono">{wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}</span> on {sources.find((s) => s.id === source)?.label}. Circle&apos;s transfer fee is taken from the amount; nothing else to pay on Arc.</p> : !wallet.available ? <p className="bi-fine">No browser wallet here. Send USDC on Arc to the address above instead.</p> : null}
      {steps.length > 0 && (
        <ol className="bi-steps">
          {steps.map((s) => (
            <li key={s.key} className={`is-${s.state}`}>
              <i aria-hidden />{s.text}{s.url ? <> · <a href={s.url} target="_blank" rel="noreferrer">tx ↗</a></> : null}
            </li>
          ))}
        </ol>
      )}
      {done && <p className="ws-note" style={{ margin: 0 }}>Burned on the source chain{done.sourceUrl ? <> (<a href={done.sourceUrl} target="_blank" rel="noreferrer">tx ↗</a>)</> : null}; Circle mints it into the account on Arc within about a minute. The balance above updates by itself.</p>}
      {err && <p className="ws-err">{err}</p>}
    </div>
  );
}
