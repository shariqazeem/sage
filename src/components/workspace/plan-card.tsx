"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getAddress, parseUnits } from "viem";
import { Check, CreditCard, Download, Loader2, Lock } from "lucide-react";
import { useWallet } from "@/lib/wallet/use-wallet";
import { chainConfig, viemChainFor } from "@/lib/deputy/networks";
import { cheapestWith, hasFeature, PLAN_ORDER, PLANS, type Feature, type PlanId } from "@/lib/plans/catalog";

const TRANSFER_ABI = [
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

interface Terms {
  to: string | null;
  periodDays: number;
  chains: { chainId: number; network: string; token: string | null }[];
  plans: { id: PlanId; name: string; priceUsd: number | null }[];
  current: { plan: PlanId; until: number | null; workspaceId: string | null } | null;
  usage: { liveJobs: number; launchedUsd: number } | null;
}
interface AccountOn { chainId: number; address: string; balanceUsd: number }

const day = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

/**
 * PLAN AND BILLING. What you're on, how much of it you've used, and the plan you came to buy, paid in
 * USDC the way Sage pays people: from your Sage account in one click (the email door, where the
 * money already is), or from any wallet that's yours. Either way Sage reads the payment on chain
 * before the plan changes. No card form, nothing stored.
 */
export function PlanCard({ preselect = null }: { preselect?: PlanId | null }) {
  const router = useRouter();
  const wallet = useWallet();
  const [terms, setTerms] = useState<Terms | null>(null);
  const [accounts, setAccounts] = useState<AccountOn[]>([]);
  const [plan, setPlan] = useState<PlanId | null>(preselect);
  const [chainId, setChainId] = useState<number | null>(null);
  const [busy, setBusy] = useState<"" | "account" | "wallet" | "confirm" | "hash">("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ plan: PlanId; until: number; receipt?: string } | null>(null);
  const [showWallet, setShowWallet] = useState(false);
  const [hash, setHash] = useState("");

  const load = useCallback(async () => {
    const t = (await fetch("/api/workspaces/plan", { cache: "no-store" }).then((r) => r.json()).catch(() => null)) as Terms | null;
    setTerms(t);
    if (!t) return;
    setChainId((c) => c ?? t.chains[0]?.chainId ?? null);
    const found: AccountOn[] = [];
    for (const c of t.chains) {
      const a = (await fetch(`/api/treasury?chainId=${c.chainId}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null)) as { linked?: boolean; address?: string; balanceUsd?: number; chainId?: number } | null;
      if (a?.linked && a.address && a.chainId === c.chainId) found.push({ chainId: c.chainId, address: a.address, balanceUsd: a.balanceUsd ?? 0 });
    }
    setAccounts(found);
    // Default to the network where the account can already pay.
    setChainId((c) => found.find((a) => a.chainId === c) ? c : found[0]?.chainId ?? c);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = terms?.current?.plan ?? "free";
  const choices = useMemo(() => (terms?.plans ?? []).filter((p) => p.priceUsd), [terms]);
  const chosen = choices.find((p) => p.id === plan) ?? null;
  const account = accounts.find((a) => a.chainId === chainId) ?? null;
  const network = chainId ? chainConfig(chainId).name : "";
  const downgradeBlocked = (id: PlanId) => current !== "free" && PLAN_ORDER.indexOf(id) < PLAN_ORDER.indexOf(current) && (terms?.current?.until ?? 0) * 1000 > Date.now();

  const finish = (until: number, receipt?: string) => {
    if (!plan) return;
    setDone({ plan, until, receipt });
    router.refresh();
    void load();
  };

  const payFromAccount = async () => {
    if (!plan || !chainId) return;
    setErr(null);
    setBusy("account");
    try {
      const res = await fetch("/api/workspaces/plan/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan, chainId }) });
      const json = (await res.json()) as { ok?: boolean; error?: string; planUntil?: number; explorerUrl?: string };
      if (!json.ok || !json.planUntil) throw new Error(json.error ?? "The payment didn't go through.");
      finish(json.planUntil, json.explorerUrl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The payment didn't go through.");
    } finally {
      setBusy("");
    }
  };

  const confirm = async (txHash: string): Promise<number> => {
    for (let i = 0; i < 20; i++) {
      const res = await fetch("/api/workspaces/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan, chainId, txHash }) });
      const json = (await res.json()) as { error?: string; retryable?: boolean; planUntil?: number };
      if (res.ok && json.planUntil) return json.planUntil;
      if (!json.retryable) throw new Error(json.error ?? "Sage couldn't confirm that payment.");
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error("The transaction is taking a while. Your payment is safe: paste its hash here in a minute.");
  };

  const payFromWallet = async () => {
    if (!chosen?.priceUsd || !chainId || !terms?.to) return;
    const token = terms.chains.find((c) => c.chainId === chainId)?.token;
    if (!token) return;
    setErr(null);
    setBusy("wallet");
    try {
      if (!wallet.address) await wallet.connect();
      if (!wallet.onChain(chainId)) await wallet.switchToChain(chainId);
      const client = wallet.getWalletClient(chainId);
      const from = wallet.address;
      if (!client || !from) throw new Error(`Connect a wallet on ${network} to pay from it.`);
      const txHash = await client.writeContract({
        account: getAddress(from),
        chain: viemChainFor(chainId),
        address: getAddress(token),
        abi: TRANSFER_ABI,
        functionName: "transfer",
        args: [getAddress(terms.to), parseUnits(String(chosen.priceUsd), 6)],
        // An ERC-20 transfer needs well under 100k; pinning it avoids a wallet's runaway estimate.
        gas: BigInt(120_000),
      });
      setBusy("confirm");
      finish(await confirm(txHash));
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : "The payment didn't go through.");
    } finally {
      setBusy("");
    }
  };

  const applyHash = async () => {
    setErr(null);
    setBusy("hash");
    try {
      finish(await confirm(hash.trim()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sage couldn't confirm that payment.");
    } finally {
      setBusy("");
    }
  };

  if (!terms) {
    return (
      <section className="ws-card" id="plan">
        <div className="ws-card-h"><h2><CreditCard size={15} /> Plan and billing</h2></div>
        <p className="ws-note pl-quiet pl-loading"><Loader2 size={13} className="sage-spin2" /> Reading your plan…</p>
      </section>
    );
  }

  const spec = PLANS[current];
  const live = terms.usage?.liveJobs ?? 0;
  const month = terms.usage?.launchedUsd ?? 0;

  return (
    <section className="ws-card" id="plan">
      <div className="ws-card-h">
        <h2><CreditCard size={15} /> Plan and billing</h2>
        <Link className="ws-chip" href="/pricing">compare plans</Link>
      </div>

      <div className="pl-now">
        <div>
          <p className="pl-name">{spec.name}</p>
          <p className="ws-note pl-quiet">{current === "free" ? "Free, forever. Workers never pay." : terms.current?.until ? `Paid until ${day(terms.current.until)}` : "Arranged with Sage"}</p>
        </div>
      </div>

      <div className="pl-meters">
        <Meter label="Live jobs" used={live} cap={spec.liveJobs} fmt={(n) => String(n)} />
        <Meter label="Work launched, last 30 days" used={month} cap={spec.monthlyUsd} fmt={money} />
      </div>

      {done ? (
        <p className="ws-ok pl-done">
          <Check size={14} /> You&apos;re on {PLANS[done.plan].name} until {day(done.until)}.
          {done.receipt && <> <a href={done.receipt} target="_blank" rel="noreferrer">See the payment</a></>}
        </p>
      ) : (
        <>
          <p className="pl-label">Change plan</p>
          <div className="pl-options" role="radiogroup" aria-label="Plan">
            {choices.map((p) => {
              const blocked = downgradeBlocked(p.id);
              return (
                <button key={p.id} type="button" role="radio" aria-checked={plan === p.id} disabled={blocked} className={`pl-option${plan === p.id ? " on" : ""}`} onClick={() => setPlan(p.id)}>
                  <span className="pl-option-name">{p.name}{p.id === current ? " (renew)" : ""}</span>
                  <span className="pl-option-price mono">${p.priceUsd}<small>/mo</small></span>
                </button>
              );
            })}
          </div>
          {chosen && terms.chains.length > 1 && (
            <div className="pl-nets" role="radiogroup" aria-label="Network">
              {terms.chains.map((c) => (
                <button key={c.chainId} type="button" role="radio" aria-checked={chainId === c.chainId} className={`pl-net${chainId === c.chainId ? " on" : ""}`} onClick={() => setChainId(c.chainId)}>
                  {c.network}
                </button>
              ))}
            </div>
          )}

          {chosen?.priceUsd && (
            <div className="pl-pay">
              {account ? (
                account.balanceUsd >= chosen.priceUsd ? (
                  <button className="sage-btn sage-btn-primary" onClick={() => void payFromAccount()} disabled={busy !== ""}>
                    {busy === "account" ? <><Loader2 size={14} className="sage-spin2" /> Paying from your account…</> : <>Pay ${chosen.priceUsd} from your account</>}
                  </button>
                ) : (
                  <p className="ws-note pl-quiet">
                    Your account on {network} holds {money(account.balanceUsd)}. <Link href={`/workspace/account?chain=${chainId}`}>Add funds</Link>, or pay from a wallet below.
                  </p>
                )
              ) : (
                <p className="ws-note pl-quiet">You don&apos;t have an account on {network} yet. Pay from a wallet below, or open one on your <Link href="/workspace/account">account page</Link>.</p>
              )}
              <p className="ws-note pl-fine">
                {chosen.name} for {terms.periodDays} days, in USDC on {network}. Upgrading credits the days left on your current plan.
              </p>

              {!showWallet ? (
                <button type="button" className="st-back" onClick={() => setShowWallet(true)}>Pay from a wallet instead</button>
              ) : (
                <div className="pl-wallet">
                  <button className="sage-btn sage-btn-sm" onClick={() => void payFromWallet()} disabled={busy !== "" || !terms.to}>
                    {busy === "wallet" ? <><Loader2 size={13} className="sage-spin2" /> Waiting for your wallet…</> : busy === "confirm" ? <><Loader2 size={13} className="sage-spin2" /> Confirming on chain…</> : <>Send ${chosen.priceUsd} USDC with a browser wallet</>}
                  </button>
                  {terms.to && (
                    <p className="ws-note pl-fine">
                      Or send exactly {chosen.priceUsd} USDC on {network} to <span className="mono">{terms.to}</span> from a wallet that&apos;s yours, and paste the transaction:
                    </p>
                  )}
                  <div className="ws-invite">
                    <input className="ws-input mono" placeholder="0x… transaction hash" value={hash} onChange={(e) => setHash(e.target.value)} />
                    <button className="sage-btn sage-btn-sm" onClick={() => void applyHash()} disabled={busy !== "" || !/^0x[0-9a-fA-F]{64}$/.test(hash.trim())}>
                      {busy === "hash" ? <Loader2 size={13} className="sage-spin2" /> : "Apply"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {err && <p className="ws-err">{err}</p>}
          <p className="ws-note pl-fine">Running a programme? <Link href="/company#contact">Programs</Link> are set up with you.</p>
        </>
      )}

      <p className="pl-label">Exports</p>
      <div className="pl-exports">
        <ExportLink plan={current} feature="exports" kind="payouts" label="Payouts (CSV)" />
        <ExportLink plan={current} feature="fraudReports" kind="fraud" label="Fraud report (CSV)" />
      </div>
    </section>
  );
}

function Meter({ label, used, cap, fmt }: { label: string; used: number; cap: number; fmt: (n: number) => string }) {
  const finite = Number.isFinite(cap);
  const pct = finite && cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  return (
    <div className="pl-meter">
      <div className="pl-meter-top">
        <span>{label}</span>
        <span className="mono">{fmt(used)}{finite ? ` of ${fmt(cap)}` : ""}</span>
      </div>
      {finite ? (
        <progress className={`pl-bar${pct >= 100 ? " full" : ""}`} value={pct} max={100} aria-label={`${label}: ${pct}%`} />
      ) : (
        <p className="ws-note pl-quiet">No limit on your plan.</p>
      )}
    </div>
  );
}

function ExportLink({ plan, feature, kind, label }: { plan: PlanId; feature: Feature; kind: string; label: string }) {
  if (hasFeature(plan, feature)) {
    return (
      <a className="sage-btn sage-btn-sm" href={`/api/workspaces/export?kind=${kind}`}>
        <Download size={13} /> {label}
      </a>
    );
  }
  return (
    <span className="sage-btn sage-btn-sm pl-locked" aria-disabled="true" title={`On ${PLANS[cheapestWith(feature)].name} and above`}>
      <Lock size={13} /> {label} · {PLANS[cheapestWith(feature)].name}
    </span>
  );
}
