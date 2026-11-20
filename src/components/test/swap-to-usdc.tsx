"use client";

import { useState } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";

import { Button } from "@/components/sage/button";
import { sameChainAddress } from "@/lib/campaigns/chain-address";
import { explorerTxUrl } from "@/lib/deputy/networks";
import { injectedSender, metisPublicClient, type Eip1193 } from "@/lib/own-wallet/browser";
import { OWN_WALLET_CHAIN_ID, legacyTx } from "@/lib/own-wallet/plan";
import { useWallet } from "@/lib/wallet/use-wallet";

interface Quote {
  amountIn: string;
  amountOut: string;
  minOut: string;
  priceImpactBps: number;
  feeWei: string;
}
interface Call {
  label: string;
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
}

const usd = (base: string): string => `$${(Number(base) / 1_000_000).toFixed(2)}`;

/**
 * HAVE METIS? SWAP SOME TO USDC HERE. For a builder whose wallet is short of m.USDC: one withdrawal of
 * METIS from an exchange then covers both the network fee and the test.
 *
 * The quote and the calls come from the server for the signed-in wallet (POST /api/wallet/swap-quote):
 * the pool's price, what they will receive and the least the router will accept, shown BEFORE anything
 * is signed. The person's own wallet then sends the call as a type-0 transaction (WS3's sender), the
 * router pays only that wallet, and Sage signs and holds nothing.
 *
 * MetaMask (or another browser wallet) only: the wallet an email sign-in holds sends no value through
 * this door yet, and is told so rather than offered a button that would fail.
 */
export function SwapToUsdc({ owner, embedded, onDone }: { owner: string; embedded: boolean; onDone: () => void }) {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<{ quote: Quote; calls: Call[]; for: string } | null>(null);
  const [busy, setBusy] = useState<"quote" | "swap" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (embedded) {
    return <p>Have METIS instead? Swapping it to USDC here works from MetaMask today, not yet from the wallet your email sign-in holds.</p>;
  }
  if (!open) {
    return (
      <div className="sg-t-notice-actions">
        <Button variant="quiet" size="sm" onClick={() => setOpen(true)}>
          Have METIS? Swap some to USDC here
        </Button>
      </div>
    );
  }

  const ask = async () => {
    setBusy("quote");
    setError(null);
    setQuote(null);
    try {
      const res = await fetch("/api/wallet/swap-quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ side: "metis_to_usdc", amount: amount.trim() }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; quote?: Quote; calls?: Call[] };
      if (res.ok && data.ok && data.quote && data.calls) setQuote({ quote: data.quote, calls: data.calls, for: amount.trim() });
      else setError(data.error ?? "Sage couldn't get a quote just now. Try again.");
    } catch {
      setError("Sage couldn't be reached. Nothing was sent; try again.");
    }
    setBusy(null);
  };

  const swap = async () => {
    if (!quote) return;
    setBusy("swap");
    setError(null);
    try {
      const provider = wallet.getProvider();
      const address = wallet.address ?? (await wallet.connect().catch(() => null));
      if (!provider || !address) {
        setError("Open this page in the browser that holds your wallet to swap from it.");
        return;
      }
      if (!sameChainAddress(address, owner)) {
        setError(`Your wallet is on ${address.slice(0, 6)}…${address.slice(-4)}. Switch it to ${owner.slice(0, 6)}…${owner.slice(-4)}, the wallet you signed in with.`);
        return;
      }
      const pub = metisPublicClient();
      const send = injectedSender(provider as unknown as Eip1193);
      let last: `0x${string}` | null = null;
      for (const call of quote.calls) {
        const value = BigInt(call.value);
        const [gasEstimate, gasPriceWei] = await Promise.all([pub.estimateGas({ account: owner as `0x${string}`, to: call.to, data: call.data, value }), pub.getGasPrice()]);
        const hash = await send(legacyTx({ chainId: OWN_WALLET_CHAIN_ID, from: owner as `0x${string}`, call: { to: call.to, data: call.data, value }, gasEstimate, gasPriceWei }));
        const receipt = await pub.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          setError("The swap didn't go through on Metis, so nothing was exchanged. Get a new quote and try again.");
          return;
        }
        last = hash;
      }
      setDone(last);
      setQuote(null);
      onDone();
    } catch (e) {
      const code = (e as { code?: number } | null)?.code;
      const msg = e instanceof Error ? e.message.split("\n")[0] : "";
      setError(code === 4001 || /user (rejected|denied)|rejected the request/i.test(msg) ? "You declined the swap. Nothing was sent." : `The swap wasn't sent${msg ? ` (${msg.slice(0, 140)})` : ""}. Nothing moved; get a new quote and try again.`);
    } finally {
      setBusy(null);
    }
  };

  const stale = quote !== null && quote.for !== amount.trim();
  return (
    <div className="sg-stack sg-gap-3">
      <form
        className="sg-t-custom"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <input className="sg-field" inputMode="decimal" aria-label="How much METIS to swap" placeholder="METIS" value={amount} disabled={busy !== null} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, "").slice(0, 12))} />
        <Button type="submit" variant="quiet" size="sm" disabled={busy !== null || !amount.trim()}>
          {busy === "quote" ? <Loader2 size={14} className="sg-spin" aria-hidden /> : null}
          Get a quote
        </Button>
      </form>
      {quote && !stale ? (
        <>
          <p>
            {quote.for} METIS gets you about <b className="sg-n">{usd(quote.quote.amountOut)}</b> m.USDC, and never less than <b className="sg-n">{usd(quote.quote.minOut)}</b>: below that the swap refuses itself and nothing moves. It goes to your own wallet, through Netswap.
          </p>
          <div className="sg-t-notice-actions">
            <Button size="sm" disabled={busy !== null} onClick={() => void swap()}>
              {busy === "swap" ? <Loader2 size={14} className="sg-spin" aria-hidden /> : null}
              {busy === "swap" ? "Swapping" : "Swap in your wallet"}
            </Button>
          </div>
        </>
      ) : null}
      {done ? (
        <p>
          Swapped.{" "}
          <a className="sg-link" href={explorerTxUrl(OWN_WALLET_CHAIN_ID, done)} target="_blank" rel="noreferrer noopener">
            The transaction <ArrowUpRight size={14} aria-hidden />
          </a>
        </p>
      ) : null}
      {error ? (
        <p className="sg-small sg-note-problem" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
