"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAddress, parseUnits } from "viem";
import { Check, Loader2, Sparkles } from "lucide-react";
import { useWallet } from "@/lib/wallet/use-wallet";
import { viemChainFor } from "@/lib/deputy/networks";

const TRANSFER_ABI = [
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

interface Terms { chainId: number; token: string; to: string; priceUsd: number; periodDays: number }

/**
 * PAY FOR PRO THE WAY SAGE PAYS PEOPLE: one USDC transfer on GOAT from the owner's wallet to the
 * operator, then the hash goes to the server, which reads the receipt itself. No card form, no
 * processor, no invoice — and the same wallet that funds the team's work funds the plan.
 */
export function ProPay({ workspaceId, priceUsd }: { workspaceId: string; priceUsd: number }) {
  const router = useRouter();
  const wallet = useWallet();
  const [terms, setTerms] = useState<Terms | null>(null);
  const [busy, setBusy] = useState<"" | "wallet" | "confirm">("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/workspaces/plan", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((t: Terms | null) => setTerms(t))
      .catch(() => setTerms(null));
  }, []);

  const confirm = async (txHash: string) => {
    for (let i = 0; i < 20; i++) {
      const res = await fetch("/api/workspaces/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, txHash }) });
      const json = (await res.json()) as { error?: string; retryable?: boolean; planUntil?: number };
      if (res.ok) return json.planUntil ?? null;
      if (!json.retryable) throw new Error(json.error ?? "Payment could not be confirmed.");
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error("The transaction is taking a while to confirm — your payment is safe; reload in a minute.");
  };

  const pay = async () => {
    if (!terms) return;
    setErr(null);
    setBusy("wallet");
    try {
      if (!wallet.address) await wallet.connect();
      if (!wallet.onChain(terms.chainId)) await wallet.switchToChain(terms.chainId);
      const client = wallet.getWalletClient(terms.chainId);
      const account = wallet.address;
      if (!client || !account) throw new Error("Connect an Ethereum wallet on GOAT to pay.");
      const txHash = await client.writeContract({
        account: getAddress(account),
        chain: viemChainFor(terms.chainId),
        address: getAddress(terms.token),
        abi: TRANSFER_ABI,
        functionName: "transfer",
        args: [getAddress(terms.to), parseUnits(String(terms.priceUsd), 6)],
      });
      setBusy("confirm");
      const until = await confirm(txHash);
      setDone(until ? new Date(until * 1000).toISOString().slice(0, 10) : "");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Payment failed.");
    } finally {
      setBusy("");
    }
  };

  if (done !== null) return <p className="ws-ok"><Check size={14} /> Pro is on{done ? ` until ${done}` : ""}.</p>;
  if (!terms) return <p className="sage-hint" style={{ marginTop: 10 }}>Pro is paid in USDC on GOAT. Payment terms are loading…</p>;
  return (
    <div style={{ marginTop: 10 }}>
      <button className="sage-btn sage-btn-primary sage-btn-sm" onClick={() => void pay()} disabled={busy !== ""}>
        {busy === "wallet" ? <><Loader2 size={14} className="sage-spin2" /> Waiting for your wallet…</> : busy === "confirm" ? <><Loader2 size={14} className="sage-spin2" /> Confirming on chain…</> : <><Sparkles size={14} /> Pay ${priceUsd} USDC for {terms.periodDays} days</>}
      </button>
      <p className="sage-hint" style={{ marginTop: 8 }}>One USDC transfer on GOAT from your wallet to Sage&rsquo;s operator address; Sage reads the receipt and switches the plan on. No card, no subscription form.</p>
      {err && <p className="ws-err">{err}</p>}
    </div>
  );
}
