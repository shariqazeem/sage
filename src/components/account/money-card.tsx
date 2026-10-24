"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { formatNative } from "@/lib/treasury/gas-policy";

/**
 * THE ACCOUNT'S MONEY, IN ONE CARD: what it holds (USDC, and the token its network fees are paid in),
 * and the three things a person does with it: add money, swap, send. Every number is read from the
 * chain through Sage's routes; every move is confirmed by the person before it is sent, and comes
 * back with its transaction.
 */

type Tab = "add" | "swap" | "send";

export interface MoneyCardProps {
  chainId: number;
  network: string;
  address: string;
  qrSvg: string;
  explorerUrl: string;
  nativeSymbol: string;
  usdcIsGas: boolean;
  canSwap: boolean;
  /** why new money must not come here (a paused network), or null */
  paused: string | null;
  initial: { usdc: number; gasWei: string | null; gasUsd: number | null; gasPriceWei: string | null; launchFloorWei: string };
  openTab?: Tab | null;
}

interface Live {
  usdc: number;
  gasWei: bigint | null;
  gasUsd: number | null;
  gasPriceWei: bigint | null;
  launchFloorWei: bigint;
}

const SWAP_GAS = BigInt(320_000);
const SEND_GAS = BigInt(60_000);
const TRANSFER_GAS = BigInt(120_000);
const fee = (units: bigint, gasPrice: bigint | null) => (gasPrice === null ? BigInt(0) : (units * gasPrice * BigInt(12)) / BigInt(10));
const toBig = (s: string | null) => (s === null ? null : BigInt(s));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Wei → a decimal string an input accepts, floored to 4 places so "max" never asks for more than is there. */
function weiToInput(wei: bigint): string {
  if (wei <= BigInt(0)) return "0";
  const whole = wei / BigInt(10) ** BigInt(18);
  const frac = ((wei % BigInt(10) ** BigInt(18)) / BigInt(10) ** BigInt(14)).toString().padStart(4, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function MoneyCard(p: MoneyCardProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab | null>(p.openTab ?? (p.initial.usdc <= 0 && !p.paused ? "add" : null));
  const [live, setLive] = useState<Live>({
    usdc: p.initial.usdc,
    gasWei: toBig(p.initial.gasWei),
    gasUsd: p.initial.gasUsd,
    gasPriceWei: toBig(p.initial.gasPriceWei),
    launchFloorWei: BigInt(p.initial.launchFloorWei),
  });

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/treasury?chainId=${p.chainId}`, { cache: "no-store" });
      const j = (await r.json()) as { balanceUsd?: number; gasWei?: string | null; gasUsd?: number | null; gasPriceWei?: string | null; launchFloorWei?: string };
      if (typeof j.balanceUsd !== "number") return;
      setLive((prev) => {
        const next: Live = {
          usdc: j.balanceUsd as number,
          gasWei: j.gasWei == null ? prev.gasWei : BigInt(j.gasWei),
          gasUsd: j.gasUsd ?? prev.gasUsd,
          gasPriceWei: j.gasPriceWei == null ? prev.gasPriceWei : BigInt(j.gasPriceWei),
          launchFloorWei: j.launchFloorWei ? BigInt(j.launchFloorWei) : prev.launchFloorWei,
        };
        const changed = next.usdc !== prev.usdc || next.gasWei !== prev.gasWei;
        if (changed) router.refresh(); // the activity list below is the server's; let it re-read
        return next;
      });
    } catch {
      /* next tick */
    }
  }, [p.chainId, router]);

  // A deposit shows up when it lands: re-read every ten seconds while the page is in view.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  const gasReady = live.gasWei !== null && live.gasWei >= live.launchFloorWei;

  return (
    <section className="acct-card" aria-label="Your money">
      <div className="acct-bal">
        <div className="acct-bal-main">
          <span className="acct-bal-k">Balance</span>
          <span className="acct-bal-v">
            ${live.usdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span className="acct-bal-u">USDC</span>
          </span>
        </div>
        {!p.usdcIsGas && (
          <div className={`acct-fee${gasReady ? " ok" : ""}`}>
            <span className="acct-bal-k">For network fees</span>
            <span className="acct-fee-v">
              {live.gasWei === null ? "—" : formatNative(live.gasWei)} {p.nativeSymbol}
              {live.gasUsd !== null && <span className="acct-fee-usd"> ≈ ${live.gasUsd.toFixed(2)}</span>}
            </span>
            <span className="acct-fee-s">
              {live.gasWei === null
                ? "couldn't read it just now"
                : gasReady
                  ? "enough to launch a job"
                  : `about ${formatNative(live.launchFloorWei)} launches a job`}
            </span>
          </div>
        )}
      </div>

      <div className="acct-actions" role="tablist" aria-label="Move money">
        {!p.paused && (
          <button type="button" role="tab" aria-selected={tab === "add"} className={`acct-act${tab === "add" ? " on" : ""}`} onClick={() => setTab(tab === "add" ? null : "add")}>
            <ArrowDownLeft size={15} /> Add money
          </button>
        )}
        {p.canSwap && !p.paused && (
          <button type="button" role="tab" aria-selected={tab === "swap"} className={`acct-act${tab === "swap" ? " on" : ""}`} onClick={() => setTab(tab === "swap" ? null : "swap")}>
            <ArrowLeftRight size={15} /> Swap
          </button>
        )}
        <button type="button" role="tab" aria-selected={tab === "send"} className={`acct-act${tab === "send" ? " on" : ""}`} onClick={() => setTab(tab === "send" ? null : "send")}>
          <ArrowUpRight size={15} /> Send
        </button>
      </div>

      {tab === "add" && !p.paused && <AddMoney {...p} />}
      {tab === "swap" && p.canSwap && !p.paused && <SwapPanel chainId={p.chainId} nativeSymbol={p.nativeSymbol} live={live} onDone={refresh} />}
      {tab === "send" && <SendPanel chainId={p.chainId} network={p.network} nativeSymbol={p.nativeSymbol} usdcIsGas={p.usdcIsGas} live={live} onDone={refresh} />}
    </section>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* nothing to do */
    }
  };
  return (
    <button type="button" className="acct-copy" onClick={() => void copy()} aria-label={`${label} ${text}`}>
      {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> {label}</>}
    </button>
  );
}

function AddMoney(p: MoneyCardProps) {
  const metis = p.nativeSymbol === "METIS";
  return (
    <div className="acct-panel" role="tabpanel">
      <div className="acct-addr-row">
        <div className="acct-qr" dangerouslySetInnerHTML={{ __html: p.qrSvg }} />
        <div className="acct-addr-main">
          <span className="acct-bal-k">Your account address on {p.network}</span>
          <code className="acct-addr">{p.address}</code>
          <div className="acct-addr-actions">
            <CopyButton text={p.address} label="Copy address" />
            <a className="acct-link" href={p.explorerUrl} target="_blank" rel="noreferrer">On the explorer <ExternalLink size={12} /></a>
          </div>
          <p className="acct-warn">Send only on the {p.network} network. Money sent on another network doesn&apos;t arrive here.</p>
        </div>
      </div>

      {metis ? (
        <ol className="acct-ways">
          <li>
            <b>From an exchange</b>
            <span>Withdraw METIS from Binance, OKX or another exchange, and choose <i>Metis</i> as the network. Then swap it to USDC here.</span>
          </li>
          <li>
            <b>From a wallet</b>
            <span>Send USDC (m.USDC) or METIS from any wallet on Metis, such as MetaMask on the Metis network.</span>
          </li>
          <li>
            <b>From Ethereum</b>
            <span>
              Bridge USDC with the <a href="https://bridge.metis.io" target="_blank" rel="noreferrer">official Metis bridge</a>. It arrives here as m.USDC.
            </span>
          </li>
        </ol>
      ) : p.usdcIsGas ? (
        <p className="acct-p">Send USDC on {p.network} from any wallet or exchange that supports it. On {p.network} USDC is the network fee too, so it needs nothing else.</p>
      ) : (
        <p className="acct-p">Send USDC on {p.network}, plus a little {p.nativeSymbol} for network fees.</p>
      )}
      {metis && <p className="acct-p faint">Network fees are paid in METIS from this account. About 0.05 METIS covers launching a job; most other moves cost well under 0.005.</p>}
    </div>
  );
}

interface QuoteView {
  side: "usdc_to_metis" | "metis_to_usdc";
  minOut: string;
  amountInText: string;
  amountOutText: string;
  minOutText: string;
  feeMetis: string;
  metisPriceUsd: number;
  priceImpactPct: number;
  venue: string;
}

function SwapPanel({ chainId, nativeSymbol, live, onDone }: { chainId: number; nativeSymbol: string; live: Live; onDone: () => Promise<void> }) {
  const [side, setSide] = useState<"metis_to_usdc" | "usdc_to_metis">(live.usdc > 0 && (live.gasWei ?? BigInt(0)) < live.launchFloorWei ? "usdc_to_metis" : "metis_to_usdc");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [stage, setStage] = useState<"edit" | "sending" | "done">("edit");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; url: string } | null>(null);
  const seq = useRef(0);

  const inSym = side === "usdc_to_metis" ? "USDC" : nativeSymbol;
  const outSym = side === "usdc_to_metis" ? nativeSymbol : "USDC";
  const balanceText = side === "usdc_to_metis" ? `${live.usdc.toFixed(2)} USDC` : `${live.gasWei === null ? "—" : formatNative(live.gasWei)} ${nativeSymbol}`;
  const max = useMemo(() => {
    if (side === "usdc_to_metis") return (Math.floor(live.usdc * 100) / 100).toFixed(2);
    const keep = fee(SWAP_GAS, live.gasPriceWei) + live.launchFloorWei;
    const g = live.gasWei ?? BigInt(0);
    return weiToInput(g > keep ? g - keep : BigInt(0));
  }, [side, live]);

  // Quote as the amount settles, never on every keystroke; a stale answer never replaces a newer one.
  useEffect(() => {
    setQuote(null);
    setErr(null);
    const v = amount.trim();
    if (!/^\d+(\.\d+)?$/.test(v) || Number(v) <= 0) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setQuoting(true);
      try {
        const r = await fetch(`/api/treasury/swap?chainId=${chainId}&side=${side}&amount=${encodeURIComponent(v)}`, { cache: "no-store" });
        const j = (await r.json()) as { ok?: boolean; quote?: QuoteView; error?: string };
        if (mine !== seq.current) return;
        if (j.ok && j.quote) setQuote(j.quote);
        else setErr(j.error ?? "No quote for that amount.");
      } catch {
        if (mine === seq.current) setErr("Couldn't reach Sage for a quote.");
      } finally {
        if (mine === seq.current) setQuoting(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [amount, side, chainId]);

  const swap = async () => {
    if (!quote) return;
    setStage("sending");
    setErr(null);
    try {
      const r = await fetch("/api/treasury/swap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId, side, amount: amount.trim(), minOut: quote.minOut }) });
      const j = (await r.json()) as { ok?: boolean; amountInText?: string; amountOutText?: string; explorerUrl?: string; error?: string };
      if (j.ok && j.explorerUrl) {
        setDone({ text: `Swapped ${j.amountInText} ${inSym} for ${j.amountOutText} ${outSym}.`, url: j.explorerUrl });
        setStage("done");
        void onDone();
      } else {
        setErr(j.error ?? "The swap didn't go through.");
        setStage("edit");
      }
    } catch {
      setErr("Couldn't reach Sage.");
      setStage("edit");
    }
  };

  if (stage === "done" && done) {
    return (
      <div className="acct-panel" role="tabpanel">
        <p className="acct-done"><Check size={15} /> {done.text} <a href={done.url} target="_blank" rel="noreferrer">Transaction <ExternalLink size={12} /></a></p>
        <button type="button" className="sage-btn sage-btn-sm" onClick={() => { setStage("edit"); setAmount(""); setDone(null); }}>Swap again</button>
      </div>
    );
  }

  return (
    <div className="acct-panel" role="tabpanel">
      <div className="acct-seg" role="radiogroup" aria-label="Which way">
        <button type="button" role="radio" aria-checked={side === "metis_to_usdc"} className={side === "metis_to_usdc" ? "on" : ""} onClick={() => setSide("metis_to_usdc")} disabled={stage !== "edit"}>
          {nativeSymbol} → USDC
        </button>
        <button type="button" role="radio" aria-checked={side === "usdc_to_metis"} className={side === "usdc_to_metis" ? "on" : ""} onClick={() => setSide("usdc_to_metis")} disabled={stage !== "edit"}>
          USDC → {nativeSymbol}
        </button>
      </div>
      <label className="acct-field">
        <span>You swap</span>
        <span className="acct-amount">
          <input className="ws-input mono" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} disabled={stage !== "edit"} aria-label={`Amount of ${inSym} to swap`} />
          <span className="acct-unit">{inSym}</span>
          <button type="button" className="acct-max" onClick={() => setAmount(max)} disabled={stage !== "edit"}>Max</button>
        </span>
        <span className="acct-hint">Balance {balanceText}{side === "metis_to_usdc" ? ` · Max keeps enough ${nativeSymbol} to launch a job` : ""}</span>
      </label>

      {quoting && !quote && <p className="acct-quote muted"><Loader2 size={13} className="sage-spin2" /> Asking the pool…</p>}
      {quote && (
        <div className="acct-quote">
          <p className="acct-quote-main">You get about <b className="mono">{quote.amountOutText} {outSym}</b></p>
          <dl className="acct-quote-rows">
            <div><dt>At least</dt><dd className="mono">{quote.minOutText} {outSym}</dd></div>
            <div><dt>Price</dt><dd className="mono">1 {nativeSymbol} = ${quote.metisPriceUsd.toFixed(3)}</dd></div>
            <div><dt>Network fee</dt><dd className="mono">≈ {quote.feeMetis} {nativeSymbol}</dd></div>
            <div><dt>Price impact</dt><dd className="mono">{quote.priceImpactPct.toFixed(2)}%</dd></div>
            <div><dt>Through</dt><dd>{quote.venue} on Metis</dd></div>
          </dl>
        </div>
      )}
      {err && <p className="ws-err">{err}</p>}
      <button type="button" className="sage-btn sage-btn-primary sage-btn-sm" disabled={!quote || stage !== "edit"} onClick={() => void swap()}>
        {stage === "sending" ? <><Loader2 size={13} className="sage-spin2" /> Swapping…</> : quote ? `Swap ${quote.amountInText} ${inSym} for at least ${quote.minOutText} ${outSym}` : "Swap"}
      </button>
      <p className="acct-p faint">The swap returns to this account only. If the price falls below “at least” before it goes through, nothing is swapped.</p>
    </div>
  );
}

function SendPanel({ chainId, network, nativeSymbol, usdcIsGas, live, onDone }: { chainId: number; network: string; nativeSymbol: string; usdcIsGas: boolean; live: Live; onDone: () => Promise<void> }) {
  const [asset, setAsset] = useState<"usdc" | "native">("usdc");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<"edit" | "confirm" | "sending" | "done">("edit");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; url: string } | null>(null);

  const sym = asset === "usdc" ? "USDC" : nativeSymbol;
  const max = useMemo(() => {
    if (asset === "usdc") {
      // where USDC is the fee (Arc) a cent stays behind, exactly as the route requires
      const usd = usdcIsGas ? Math.max(0, live.usdc - 0.01) : live.usdc;
      return (Math.floor(usd * 100) / 100).toFixed(2);
    }
    const g = live.gasWei ?? BigInt(0);
    const f = fee(SEND_GAS, live.gasPriceWei);
    return weiToInput(g > f ? g - f : BigInt(0));
  }, [asset, live, usdcIsGas]);
  const n = Number(amount);
  const valid = ADDRESS.test(to.trim()) && /^\d+(\.\d+)?$/.test(amount.trim()) && n > 0 && n <= Number(max) + 1e-9;
  const usdcFeeShort = asset === "usdc" && !usdcIsGas && live.gasWei !== null && live.gasPriceWei !== null && live.gasWei < fee(TRANSFER_GAS, live.gasPriceWei);

  const send = async () => {
    setStage("sending");
    setErr(null);
    try {
      const body = asset === "usdc" ? { to: to.trim(), amountUsd: n, chainId } : { to: to.trim(), amount: amount.trim(), asset: "native", chainId };
      const r = await fetch("/api/treasury/withdraw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json()) as { ok?: boolean; explorerUrl?: string; error?: string };
      if (j.ok && j.explorerUrl) {
        setDone({ text: `Sent ${asset === "usdc" ? n.toFixed(2) : amount.trim()} ${sym} to ${short(to.trim())}.`, url: j.explorerUrl });
        setStage("done");
        void onDone();
      } else {
        setErr(j.error ?? "That didn't go through.");
        setStage("edit");
      }
    } catch {
      setErr("Couldn't reach Sage.");
      setStage("edit");
    }
  };

  if (stage === "done" && done) {
    return (
      <div className="acct-panel" role="tabpanel">
        <p className="acct-done"><Check size={15} /> {done.text} <a href={done.url} target="_blank" rel="noreferrer">Transaction <ExternalLink size={12} /></a></p>
        <button type="button" className="sage-btn sage-btn-sm" onClick={() => { setStage("edit"); setTo(""); setAmount(""); setDone(null); }}>Send again</button>
      </div>
    );
  }

  return (
    <div className="acct-panel" role="tabpanel">
      {!usdcIsGas && (
        <div className="acct-seg" role="radiogroup" aria-label="What to send">
          <button type="button" role="radio" aria-checked={asset === "usdc"} className={asset === "usdc" ? "on" : ""} onClick={() => setAsset("usdc")} disabled={stage !== "edit"}>USDC</button>
          <button type="button" role="radio" aria-checked={asset === "native"} className={asset === "native" ? "on" : ""} onClick={() => setAsset("native")} disabled={stage !== "edit"}>{nativeSymbol}</button>
        </div>
      )}
      <label className="acct-field">
        <span>To</span>
        <input className="ws-input mono" placeholder={`0x… any address on ${network}`} value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} disabled={stage !== "edit"} aria-label="Send to address" />
      </label>
      <label className="acct-field">
        <span>Amount</span>
        <span className="acct-amount">
          <input className="ws-input mono" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} disabled={stage !== "edit"} aria-label={`Amount of ${sym}`} />
          <span className="acct-unit">{sym}</span>
          <button type="button" className="acct-max" onClick={() => setAmount(max)} disabled={stage !== "edit"}>Max</button>
        </span>
        <span className="acct-hint">{asset === "usdc" ? `Balance ${live.usdc.toFixed(2)} USDC` : `Balance ${live.gasWei === null ? "—" : formatNative(live.gasWei)} ${nativeSymbol} · the fee comes out of it`}</span>
      </label>
      {usdcFeeShort && <p className="acct-warn">This account has no {nativeSymbol} for the network fee yet. Add a little first (Add money), or swap some USDC to {nativeSymbol}.</p>}
      {stage === "edit" && (
        <button type="button" className="sage-btn sage-btn-primary sage-btn-sm" disabled={!valid} onClick={() => setStage("confirm")}>Review</button>
      )}
      {stage !== "edit" && (
        <div className="acct-confirm">
          <p>
            Send <b className="mono">{asset === "usdc" ? n.toFixed(2) : amount.trim()} {sym}</b> to <span className="mono">{to.trim()}</span> on {network}? Sage opens a one-time permit for this address and amount only, then locks the account again.
          </p>
          <div className="acct-confirm-row">
            <button type="button" className="sage-btn sage-btn-primary sage-btn-sm" onClick={() => void send()} disabled={stage === "sending"}>
              {stage === "sending" ? <><Loader2 size={13} className="sage-spin2" /> Sending…</> : "Yes, send it"}
            </button>
            <button type="button" className="sage-btn sage-btn-sm" onClick={() => setStage("edit")} disabled={stage === "sending"}>Back</button>
          </div>
        </div>
      )}
      {err && <p className="ws-err">{err}</p>}
    </div>
  );
}
