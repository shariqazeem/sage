"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CreditCard, Download, Gift, Loader2, Lock, Receipt } from "lucide-react";
import { cheapestWith, hasFeature, PLAN_ORDER, PLANS, type Feature, type PlanId } from "@/lib/plans/catalog";
import type { BillingView } from "@/lib/plans/billing-view";

interface Terms {
  periodDays: number;
  plans: { id: PlanId; name: string; priceUsd: number | null }[];
  view: BillingView | null;
}

const day = (sec: number) => new Date(sec * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
const METHOD: Record<string, string> = { balance: "Sage balance", wallet: "Wallet", renewal: "Renewal" };

/**
 * PLAN AND BILLING, the way a subscription page reads: the plan you're on, when it renews and from
 * where (with the switch to stop it), what you've used, how to change plan, and every payment with its
 * receipt. Paying happens at checkout (/checkout); this card is where you look after it.
 */
export function PlanCard({ preselect = null }: { preselect?: PlanId | null }) {
  const [terms, setTerms] = useState<Terms | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const t = (await fetch("/api/workspaces/plan", { cache: "no-store" }).then((r) => r.json()).catch(() => null)) as Terms | null;
    setTerms(t);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const view = terms?.view ?? null;
  if (!terms || !view) {
    return (
      <section className="ws-card" id="plan">
        <div className="ws-card-h"><h2><CreditCard size={15} /> Plan and billing</h2></div>
        <p className="ws-note pl-quiet pl-loading"><Loader2 size={13} className="sage-spin2" /> Reading your plan…</p>
      </section>
    );
  }

  const current = view.plan;
  const spec = PLANS[current];
  const price = terms.plans.find((p) => p.id === current)?.priceUsd ?? null;
  const paid = current !== "free" && view.until != null;
  const arranged = current !== "free" && !price;
  const setRenew = async (on: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/workspaces/plan", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ autoRenew: on }) });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "That couldn't be changed.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That couldn't be changed.");
    } finally {
      setBusy(false);
    }
  };
  const upgrades = terms.plans.filter((p) => p.priceUsd && PLAN_ORDER.indexOf(p.id) > PLAN_ORDER.indexOf(current));
  const history = [
    ...view.payments.map((p) => ({ key: p.txHash, at: p.paidAt, what: `${p.planName}, ${day(p.periodStart)} to ${day(p.planUntil)}`, how: p.method ? METHOD[p.method] : p.network, amount: money(p.amountUsd), href: p.receiptUrl })),
    ...view.freeDays.map((f) => ({ key: `promo:${f.code}`, at: f.redeemedAt, what: `${f.planName}, ${f.days} free days`, how: `Code ${f.code}`, amount: "$0", href: null as string | null })),
  ].sort((a, b) => b.at - a.at);

  return (
    <section className="ws-card" id="plan">
      <div className="ws-card-h">
        <h2><CreditCard size={15} /> Plan and billing</h2>
        <Link className="ws-chip" href="/pricing">compare plans</Link>
      </div>

      {preselect && preselect !== current && PLANS[preselect].priceUsd ? (
        <div className="pl-continue">
          <p className="ws-note pl-quiet">You chose {PLANS[preselect].name}.</p>
          <Link className="sage-btn sage-btn-primary sage-btn-sm" href={`/checkout?plan=${preselect}`}>
            Continue to checkout <ArrowRight size={13} />
          </Link>
        </div>
      ) : null}

      <div className="pl-now">
        <div>
          <p className="pl-name">{spec.name}{price ? <span className="pl-price mono"> {money(price)}/mo</span> : null}</p>
          <p className="ws-note pl-quiet">
            {current === "free"
              ? "Free, forever. The people you pay never pay."
              : arranged
                ? `Arranged with Sage${view.until ? `, until ${day(view.until)}` : ""}.`
                : view.until
                  ? view.autoRenew && view.balance
                    ? `Renews on ${day(view.until)} from your Sage balance.`
                    : `Runs until ${day(view.until)}.`
                  : ""}
          </p>
        </div>
        {paid && !arranged && view.canManage && view.balance ? (
          <label className="pl-renew">
            <input type="checkbox" checked={view.autoRenew} disabled={busy} onChange={(e) => void setRenew(e.target.checked)} />
            <span>Renew automatically</span>
          </label>
        ) : null}
      </div>

      {view.notice && <p className={`pl-notice ${view.notice.tone}`}>{view.notice.text}</p>}
      {err && <p className="ws-err">{err}</p>}

      <div className="pl-meters">
        <Meter label="Live jobs" used={view.usage.liveJobs} cap={spec.liveJobs} fmt={(n) => String(n)} />
        <Meter label="Work launched, last 30 days" used={view.usage.launchedUsd} cap={spec.monthlyUsd} fmt={money} />
      </div>

      {view.canManage && !arranged && (
        <div className="pl-actions">
          {paid && price ? (
            <Link className="sage-btn sage-btn-sm" href={`/checkout?plan=${current}`}>Renew {spec.name} now</Link>
          ) : null}
          {upgrades.map((p) => (
            <Link key={p.id} className={`sage-btn sage-btn-sm${current === "free" && p.id === "pro" ? " sage-btn-primary" : ""}`} href={`/checkout?plan=${p.id}`}>
              {current === "free" ? `Get ${p.name}` : `Upgrade to ${p.name}`} <span className="mono">{money(p.priceUsd ?? 0)}/mo</span>
            </Link>
          ))}
          <Link className="sage-btn sage-btn-sm" href={`/checkout?plan=${current === "free" ? "pro" : current}`}><Gift size={13} /> Use a promo code</Link>
        </div>
      )}
      {arranged && <p className="ws-note pl-fine">Your plan was set up with Sage. <Link href="/company#contact">Talk to us</Link> to change it.</p>}

      <p className="pl-label">Billing history</p>
      {history.length === 0 ? (
        <p className="ws-note pl-quiet">No payments yet. Every payment gets a receipt here.</p>
      ) : (
        <ul className="pl-history">
          {history.map((h) => (
            <li key={h.key}>
              <span className="pl-h-when mono">{day(h.at)}</span>
              <span className="pl-h-what">{h.what}<small>{h.how}</small></span>
              <span className="pl-h-amt mono">{h.amount}</span>
              {h.href ? <Link className="ws-chip" href={h.href}><Receipt size={11} /> receipt</Link> : <span className="pl-h-pad" aria-hidden />}
            </li>
          ))}
        </ul>
      )}

      <p className="pl-label">Exports</p>
      <div className="pl-exports">
        <ExportLink plan={current} feature="exports" kind="payouts" label="Payouts (CSV)" />
        <ExportLink plan={current} feature="fraudReports" kind="fraud" label="Fraud report (CSV)" />
      </div>
      <p className="ws-note pl-fine">Running a programme? <Link href="/company#contact">Programs</Link> are set up with you.</p>
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
