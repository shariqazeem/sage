"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAddress, parseUnits } from "viem";
import { ArrowLeft, Check, Copy, Gift, Loader2, Lock, Receipt, RefreshCw, ShieldCheck, Tag, Wallet, X } from "lucide-react";
import { SageMark } from "@/components/brand/sage-mark";
import { useWallet } from "@/lib/wallet/use-wallet";
import { viemChainFor } from "@/lib/deputy/networks";

const TRANSFER_ABI = [
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

export interface CheckoutProps {
  plan: { id: string; name: string; blurb: string; priceUsd: number; highlights: readonly string[] };
  current: { name: string; isFree: boolean };
  /** what paying buys right now, or why it can't be bought. */
  quote: { ok: true; until: number; creditDays: number; renewing: boolean } | { ok: false; error: string };
  billing: { chainId: number; network: string; token: string; to: string } | null;
  balance: { address: string; usd: number | null } | null;
  /** why there is no Sage balance on the billing network yet (Metis before it opens), or null. */
  balanceClosed: string | null;
  autoRenew: boolean;
  canManage: boolean;
  periodDays: number;
  /** a promo code from the link that brought them here (?code=), checked once the page loads. */
  initialCode?: string | null;
}

type Promo =
  | { kind: "days"; code: string; days: number; label: string }
  | { kind: "percent"; code: string; percentOff: number; discountedUsd: number; label: string };

type Method = "balance" | "wallet";
type Phase = "idle" | "sending" | "confirming" | "done";

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (sec: number) => new Date(sec * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * THE CHECKOUT. Buying a plan should feel like buying software with a card: see what you get, pick how
 * to pay, press one button, get a receipt. The Sage balance is the saved card (one click, and it renews
 * itself each month unless you turn that off); a wallet is the other way to pay, from MetaMask or any
 * browser wallet. Either way the server reads the payment on chain before the plan changes.
 */
export function Checkout(props: CheckoutProps) {
  const { plan, quote, billing, canManage } = props;
  const wallet = useWallet();
  const [balanceUsd, setBalanceUsd] = useState<number | null>(props.balance?.usd ?? null);
  const enoughFor = (usdDue: number) => balanceUsd != null && balanceUsd >= usdDue;
  const [method, setMethod] = useState<Method>(props.balance && enoughFor(plan.priceUsd) ? "balance" : "wallet");
  const [autoRenew, setAutoRenew] = useState(props.autoRenew);
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ until: number; receiptUrl: string; explorerUrl?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showHash, setShowHash] = useState(false);
  const [hash, setHash] = useState("");
  const [promo, setPromo] = useState<Promo | null>(null);
  const [promoOpen, setPromoOpen] = useState(!!props.initialCode);
  const [promoInput, setPromoInput] = useState(props.initialCode ?? "");
  const [promoErr, setPromoErr] = useState<string | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const due = promo?.kind === "percent" ? promo.discountedUsd : promo?.kind === "days" ? 0 : plan.priceUsd;

  const checkPromo = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      setPromoBusy(true);
      setPromoErr(null);
      try {
        const res = await fetch(`/api/billing/promo?plan=${encodeURIComponent(plan.id)}&code=${encodeURIComponent(code)}`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; kind?: "days" | "percent"; code?: string; days?: number; percentOff?: number; discountedUsd?: number; label?: string };
        if (!json.ok || !json.code || !json.label) throw new Error(json.error ?? "That code isn't valid.");
        setPromo(json.kind === "days" ? { kind: "days", code: json.code, days: json.days ?? 0, label: json.label } : { kind: "percent", code: json.code, percentOff: json.percentOff ?? 0, discountedUsd: json.discountedUsd ?? plan.priceUsd, label: json.label });
      } catch (e) {
        setPromo(null);
        setPromoErr(e instanceof Error ? e.message : "That code isn't valid.");
      } finally {
        setPromoBusy(false);
      }
    },
    [plan.id, plan.priceUsd],
  );
  useEffect(() => {
    if (props.initialCode) void checkPromo(props.initialCode);
  }, [props.initialCode, checkPromo]);

  const enough = enoughFor(due);
  // While someone tops up their balance to pay, the page watches it rise instead of asking them to reload.
  const watching = method === "balance" && !!props.balance && !enough && phase === "idle";
  const refreshBalance = useCallback(async () => {
    if (!billing) return;
    const r = (await fetch(`/api/treasury?chainId=${billing.chainId}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null)) as { balanceUsd?: number; chainId?: number } | null;
    if (r?.chainId === billing.chainId && typeof r.balanceUsd === "number") setBalanceUsd(r.balanceUsd);
  }, [billing]);
  useEffect(() => {
    if (!watching) return;
    const id = setInterval(() => void refreshBalance(), 6000);
    return () => clearInterval(id);
  }, [watching, refreshBalance]);

  const blocked = !canManage ? "Only the workspace owner or an admin can buy a plan." : !billing ? "Plan payments aren't open on this deployment yet." : !quote.ok ? quote.error : null;
  const canPay = !blocked && phase === "idle" && (promo?.kind === "days" || (method === "wallet" ? wallet.available : !!props.balance && enough));
  const renewsFrom = props.balance ? "your Sage balance" : null;

  const confirm = async (txHash: string): Promise<{ until: number; receiptUrl: string }> => {
    for (let i = 0; i < 30; i++) {
      const res = await fetch("/api/workspaces/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan: plan.id, chainId: billing?.chainId, txHash, autoRenew: props.balance ? autoRenew : undefined, promo: promo?.kind === "percent" ? promo.code : undefined }) });
      const json = (await res.json().catch(() => ({}))) as { error?: string; retryable?: boolean; planUntil?: number; receiptUrl?: string };
      if (res.ok && json.planUntil) return { until: json.planUntil, receiptUrl: json.receiptUrl ?? `/billing/receipt/${txHash}` };
      if (!json.retryable) throw new Error(json.error ?? "Sage couldn't confirm that payment.");
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error(`Your payment is safe; it is taking a while to confirm. Paste this transaction under "Paid another way?" in a minute: ${txHash}`);
  };

  const payFromBalance = async () => {
    setPhase("sending");
    const res = await fetch("/api/workspaces/plan/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan: plan.id, chainId: billing?.chainId, autoRenew, promo: promo?.kind === "percent" ? promo.code : undefined }) });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; planUntil?: number; receiptUrl?: string; explorerUrl?: string; txHash?: string; code?: string };
    if (json.ok && json.planUntil) return { until: json.planUntil, receiptUrl: json.receiptUrl ?? "", explorerUrl: json.explorerUrl };
    if (json.code === "unconfirmed" && json.txHash) {
      setPhase("confirming");
      return confirm(json.txHash);
    }
    throw new Error(json.error ?? "The payment didn't go through.");
  };

  const payFromWallet = async () => {
    if (!billing) throw new Error("Plan payments aren't open yet.");
    setPhase("sending");
    if (!wallet.address) await wallet.connect();
    if (!wallet.onChain(billing.chainId)) await wallet.switchToChain(billing.chainId);
    const client = wallet.getWalletClient(billing.chainId);
    const from = wallet.address;
    if (!client || !from) throw new Error(`Connect a wallet on ${billing.network} to pay from it.`);
    const txHash = await client.writeContract({
      account: getAddress(from),
      chain: viemChainFor(billing.chainId),
      address: getAddress(billing.token),
      abi: TRANSFER_ABI,
      functionName: "transfer",
      args: [getAddress(billing.to), parseUnits(due.toFixed(2), 6)],
      // An ERC-20 transfer needs well under 100k; pinning it avoids a wallet's runaway estimate.
      gas: BigInt(120_000),
    });
    setPhase("confirming");
    return confirm(txHash);
  };

  const redeemDays = async (): Promise<{ until: number; receiptUrl: string }> => {
    if (promo?.kind !== "days") throw new Error("That code isn't valid.");
    setPhase("sending");
    const res = await fetch("/api/billing/promo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: promo.code, plan: plan.id }) });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; planUntil?: number };
    if (!json.ok || !json.planUntil) throw new Error(json.error ?? "That code couldn't be used.");
    return { until: json.planUntil, receiptUrl: "" };
  };

  const pay = async () => {
    setErr(null);
    try {
      const r = promo?.kind === "days" ? await redeemDays() : method === "balance" ? await payFromBalance() : await payFromWallet();
      setResult(r);
      setPhase("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : "The payment didn't go through.");
      setPhase("idle");
    }
  };

  const applyHash = async () => {
    setErr(null);
    setPhase("confirming");
    try {
      setResult(await confirm(hash.trim()));
      setPhase("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sage couldn't confirm that payment.");
      setPhase("idle");
    }
  };

  const copyAddress = async () => {
    if (!props.balance) return;
    try {
      await navigator.clipboard.writeText(props.balance.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* the address is on screen to select */
    }
  };

  const summary = useMemo(() => {
    if (!quote.ok) return null;
    return { until: quote.until, credit: quote.creditDays, renewing: quote.renewing };
  }, [quote]);

  return (
    <div className="ck">
      <header className="ck-head">
        <div className="ck-head-in">
          <Link href="/" className="ck-brand" aria-label="Sage home">
            <SageMark size={22} />
            <span>Sage</span>
            <small>Checkout</small>
          </Link>
          <span className="ck-secure">
            <Lock size={14} /> <span>Paid in USDC{billing ? ` on ${billing.network}` : ""}</span>
          </span>
        </div>
      </header>

      <main className="ck-main">
        <section aria-label="Your order">
          <Link href="/pricing" className="ck-back">
            <ArrowLeft size={14} /> All plans
          </Link>
          <div className="ck-plan">
            <div className="ck-plan-name">Sage {plan.name}</div>
            <div className="ck-price">
              <b>{usd(plan.priceUsd)}</b>
              <span>a month</span>
            </div>
            <p className="ck-blurb">{plan.blurb}</p>
          </div>
          <ul className="ck-gets">
            {plan.highlights.map((h) => (
              <li key={h}>
                <Check size={16} strokeWidth={2.2} />
                <span>{h}</span>
              </li>
            ))}
          </ul>
          <div className="ck-lines">
            <div className="ck-line">
              <span>Sage {plan.name}, {promo?.kind === "days" ? promo.days : props.periodDays} days</span>
              <span className="num">{promo?.kind === "days" ? "Free" : usd(plan.priceUsd)}</span>
            </div>
            {promo?.kind === "percent" && (
              <div className="ck-line promo">
                <span>
                  <Tag size={13} /> {promo.code}, {promo.percentOff}% off
                </span>
                <span className="num">−{usd(plan.priceUsd - promo.discountedUsd)}</span>
              </div>
            )}
            {summary && summary.credit > 0 && promo?.kind !== "days" && (
              <div className="ck-line">
                <span>Days left on {props.current.name}, carried over</span>
                <span className="num">+{summary.credit} days</span>
              </div>
            )}
            <div className="ck-line total">
              <span>Due today</span>
              <b>{usd(due)} USDC</b>
            </div>
          </div>

          <div className="ck-promo">
            {promo ? (
              <div className="ck-promo-on">
                <Gift size={14} />
                <span>
                  <b>{promo.code}</b>: {promo.label}
                </span>
                <button
                  type="button"
                  aria-label="Remove the code"
                  disabled={phase !== "idle"}
                  onClick={() => {
                    setPromo(null);
                    setPromoInput("");
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            ) : !promoOpen ? (
              <button type="button" className="ck-link" onClick={() => setPromoOpen(true)}>
                Have a promo code?
              </button>
            ) : (
              <form
                className="ck-hash"
                onSubmit={(e) => {
                  e.preventDefault();
                  void checkPromo(promoInput);
                }}
              >
                <input aria-label="Promo code" placeholder="Promo code" value={promoInput} onChange={(e) => setPromoInput(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
                <button type="submit" className="ck-btn-quiet" disabled={promoBusy || !promoInput.trim()}>
                  {promoBusy ? <Loader2 size={13} className="ck-spin" /> : "Apply"}
                </button>
              </form>
            )}
            {promoErr && <p className="ck-promo-err" role="alert">{promoErr}</p>}
          </div>

          {promo?.kind === "days" ? (
            <p className="ck-fine">Nothing is charged. {plan.name} is yours for {promo.days} days, and Sage reminds you before it ends. Your live jobs keep paying people whatever happens to your plan.</p>
          ) : (
            summary && (
              <p className="ck-fine">
                {summary.renewing ? `Adds ${props.periodDays} days: ${plan.name} runs until ${date(summary.until)}.` : `${plan.name} starts now and runs until ${date(summary.until)}.`}{" "}
                {renewsFrom && autoRenew ? `Then it renews every ${props.periodDays} days from ${renewsFrom} at ${usd(plan.priceUsd)}, until you turn that off.` : "We'll remind you before it ends."}{" "}
                Your live jobs keep paying people whatever happens to your plan.
              </p>
            )
          )}
        </section>

        <section className="ck-pay" aria-label="Payment">
          {phase === "done" && result ? (
            <div className="ck-done" role="status">
              <div className="ck-done-mark">
                <Check size={28} strokeWidth={2.4} />
              </div>
              <h2>You&apos;re on {plan.name}</h2>
              {promo?.kind === "days" ? (
                <p>Nothing was charged. {plan.name} runs until {date(result.until)}.</p>
              ) : (
                <p>
                  Paid {usd(due)} USDC. {plan.name} runs until {date(result.until)}
                  {renewsFrom && autoRenew ? ` and renews from ${renewsFrom}.` : "."}
                </p>
              )}
              <div className="ck-done-actions">
                <Link href="/workspace" className="ck-btn">
                  Go to your workspace
                </Link>
                {result.receiptUrl && (
                  <Link href={result.receiptUrl} className="ck-btn-quiet">
                    <Receipt size={14} /> Receipt
                  </Link>
                )}
              </div>
            </div>
          ) : promo?.kind === "days" ? (
            <>
              <h2>Your free {plan.name}</h2>
              <p className="ck-note">
                {promo.label}. There&apos;s nothing to pay: start it now, and it runs for {promo.days} days.
              </p>
              {(blocked || err) && <p className="ck-err" role="alert">{err ?? blocked}</p>}
              {phase === "idle" ? (
                <button type="button" className="ck-btn" disabled={!canPay} onClick={() => void pay()}>
                  Start {promo.days} free days
                </button>
              ) : (
                <ol className="ck-steps" aria-live="polite">
                  <li className="on">
                    <Loader2 size={16} className="ck-spin" />
                    <span>Starting your plan</span>
                  </li>
                </ol>
              )}
            </>
          ) : (
            <>
              <h2>Pay with</h2>
              <div className="ck-methods" role="radiogroup" aria-label="Payment method">
                {props.balance ? (
                  <button type="button" role="radio" aria-checked={method === "balance"} className="ck-method" disabled={phase !== "idle"} onClick={() => setMethod("balance")}>
                    <span className="ck-radio" aria-hidden />
                    <span className="ck-method-icon" aria-hidden>
                      <SageMark size={18} />
                    </span>
                    <span>
                      <span className="ck-method-t">Sage balance</span>
                      <span className="ck-method-s">
                        <span className="num">{balanceUsd == null ? "…" : usd(balanceUsd)}</span> available on {billing?.network}. One click, and it can renew itself.
                      </span>
                    </span>
                  </button>
                ) : (
                  // Not selectable yet: a card that says how it opens, never a button with a link inside it.
                  <div role="radio" aria-checked={false} aria-disabled="true" className="ck-method">
                    <span className="ck-radio" aria-hidden />
                    <span className="ck-method-icon" aria-hidden>
                      <SageMark size={18} />
                    </span>
                    <span>
                      <span className="ck-method-t">Sage balance</span>
                      <span className="ck-method-s">
                        {props.balanceClosed ?? (
                          <>
                            Open a balance on <Link href={`/workspace/account?chain=${billing?.chainId ?? ""}`}>your account page</Link> to pay in one click and renew automatically.
                          </>
                        )}
                      </span>
                    </span>
                  </div>
                )}
                <button type="button" role="radio" aria-checked={method === "wallet"} className="ck-method" disabled={phase !== "idle"} onClick={() => setMethod("wallet")}>
                  <span className="ck-radio" aria-hidden />
                  <span className="ck-method-icon" aria-hidden>
                    <Wallet size={18} />
                  </span>
                  <span>
                    <span className="ck-method-t">Your wallet</span>
                    <span className="ck-method-s">
                      MetaMask or any browser wallet, with USDC on {billing?.network ?? "Metis"}. It also needs a little {billing ? "METIS" : "gas"} for the network fee, less than a cent.
                    </span>
                  </span>
                </button>
              </div>

              {method === "balance" && props.balance && !enough && balanceUsd != null && (
                <div className="ck-topup" aria-live="polite">
                  Add {usd(due - balanceUsd)} of USDC on {billing?.network} to your Sage balance, from any wallet or exchange that sends USDC on {billing?.network}. This page sees it arrive.
                  <div className="ck-addr">
                    <code>{props.balance.address}</code>
                    <button type="button" className="ck-btn-quiet" onClick={() => void copyAddress()}>
                      {copied ? "Copied" : <><Copy size={13} /> Copy</>}
                    </button>
                    <button type="button" className="ck-btn-quiet" aria-label="Check the balance again" onClick={() => void refreshBalance()}>
                      <RefreshCw size={13} />
                    </button>
                  </div>
                </div>
              )}

              {props.balance ? (
                <label className="ck-renew">
                  <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} disabled={phase !== "idle"} />
                  <span>
                    Renew automatically every {props.periodDays} days from my Sage balance
                    <small>A reminder comes three days before. Turn it off any time in Settings, and the plan runs to the end of its month.</small>
                  </span>
                </label>
              ) : (
                <p className="ck-note">This plan runs for {props.periodDays} days. Sage reminds you before it ends, and renewing is one click.</p>
              )}

              {method === "wallet" && !wallet.available && !blocked && (
                <p className="ck-note">No browser wallet found here. Install MetaMask (or open this page in your wallet&apos;s browser){props.balance ? ", or pay from your Sage balance" : ""}.</p>
              )}
              {(blocked || err) && <p className="ck-err" role="alert">{err ?? blocked}</p>}

              {phase === "idle" ? (
                <button type="button" className="ck-btn" disabled={!canPay} onClick={() => void pay()}>
                  Pay {usd(due)}
                </button>
              ) : (
                <ol className="ck-steps" aria-live="polite">
                  <li className={phase === "sending" ? "on" : "done"}>
                    {phase === "sending" ? <Loader2 size={16} className="ck-spin" /> : <Check size={16} />}
                    <span>{method === "wallet" ? "Approve the payment in your wallet" : "Sending from your Sage balance"}</span>
                  </li>
                  <li className={phase === "confirming" ? "on" : ""}>
                    {phase === "confirming" ? <Loader2 size={16} className="ck-spin" /> : <span aria-hidden />}
                    <span>Confirming on {billing?.network}</span>
                  </li>
                </ol>
              )}

              {phase === "idle" && (
                <>
                  {!showHash ? (
                    <button type="button" className="ck-link" onClick={() => setShowHash(true)}>
                      Paid another way?
                    </button>
                  ) : (
                    <>
                      <p className="ck-note">
                        Sent exactly {usd(due)} USDC on {billing?.network} to <span className="ck-method-s num">{billing?.to}</span> from a wallet that&apos;s yours? Paste the transaction:
                      </p>
                      <div className="ck-hash">
                        <input placeholder="0x… transaction hash" value={hash} onChange={(e) => setHash(e.target.value)} aria-label="Transaction hash" />
                        <button type="button" className="ck-btn-quiet" disabled={!/^0x[0-9a-fA-F]{64}$/.test(hash.trim())} onClick={() => void applyHash()}>
                          Apply
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}

              <div className="ck-trust">
                <div>
                  <ShieldCheck size={14} />
                  <span>Sage reads your payment on chain before your plan changes, and you get a receipt for it.</span>
                </div>
                <div>
                  <Receipt size={14} />
                  <span>No fee on payouts: your budget goes to the people you pay, and the people you pay never pay.</span>
                </div>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
