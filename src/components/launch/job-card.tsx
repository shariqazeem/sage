"use client";

import { useState, type ReactNode } from "react";
import { CircleCheck, Minus, Plus, X } from "lucide-react";
import type { Tranche } from "@/lib/launch/composer";

/**
 * THE JOB, AS ONE CARD (28 Oct 2026). Sage reads what the founder handed over and writes the job; this is
 * what comes back. The two decisions that are the founder's, what it pays and who can do it, are taps.
 * Everything Sage decided (the steps, what "done" means, how it checks) is written out to read, and a
 * check can be dropped with one tap. The card reads and writes the composer's own state, so it and the
 * full form ("Change the details") can never disagree.
 *
 * The money rule holds: an amount is the founder's tap or the founder's words, never the model's.
 */
export type CardPatch = { slots?: string; tranches?: Tranche[]; splitTotal?: string; inviteOnly?: boolean };

const PER_PERSON = [5, 20, 50, 100];
const GRANT_TOTAL = [50, 100, 250, 500];

/** How Sage checks a line of work, in the words the founder reads. */
function checksLine(t: Tranche, chainName: (id?: number) => string): string {
  if (t.verify === "page") return `Sage checks the page they submit shows “${t.expectedText.trim() || "…"}”, before it pays`;
  if (t.verify === "onchain") return `Sage checks the transaction on ${chainName(t.txChain)}, sent from their own wallet, before it pays`;
  return `Sage checks the link they submit${t.minWords ? `, at least ${t.minWords} words of their own,` : ""} and that it carries their wallet address, before it pays`;
}

const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * Fixed amounts to tap, and Other to type one: the founder's own number, never a model's. The product
 * test's budget uses the same control, so a price is chosen the same way everywhere on Post.
 */
export function AmountChips({
  values,
  value,
  symbol,
  onChange,
  label,
  typeOnly = false,
}: {
  values: number[];
  value: string;
  symbol: string;
  onChange: (v: string) => void;
  label: string;
  /** a currency the chips are not priced in: the amount is typed */
  typeOnly?: boolean;
}) {
  const [other, setOther] = useState(false);
  const onChip = values.some((c) => Number(value) === c);
  const typing = typeOnly || other || (!!value && !onChip);
  return (
    <span className="jc-amounts">
      {!typeOnly &&
        values.map((c) => {
          const on = Number(value) === c && !other;
          return (
            <button
              key={c}
              type="button"
              className={`jc-chip mono${on ? " on" : ""}`}
              aria-pressed={on}
              onClick={() => {
                setOther(false);
                onChange(String(c));
              }}
            >
              {symbol}
              {c}
            </button>
          );
        })}
      {typing ? (
        <span className="jc-other">
          <span className="mono">{symbol}</span>
          <input className="jc-amt mono" type="number" min="0.5" step="0.5" inputMode="decimal" autoFocus={other} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
        </span>
      ) : (
        <button
          type="button"
          className="jc-chip"
          onClick={() => {
            setOther(true);
            onChange("");
          }}
        >
          Other
        </button>
      )}
    </span>
  );
}

export function JobCard({
  title,
  from,
  slots,
  tranches,
  splitTotal,
  shares,
  currencySymbol,
  isLocal,
  inviteOnly,
  canInvite,
  chainName,
  onChange,
  onDetails,
  detailsOpen,
  action,
  note,
}: {
  title: string;
  /** "github.com/acme/app/issues/42" when Sage read a link; null when it worked from words */
  from: string | null;
  slots: string;
  tranches: Tranche[];
  splitTotal: string;
  /** the exact split of a stated total across the milestones, as the composer previews it */
  shares: string[];
  currencySymbol: string;
  /** priced in another currency: the amount is typed in it, and the dollar chips stand aside */
  isLocal: boolean;
  inviteOnly: boolean;
  /** whether this workspace can admit invited people yet; null while unknown */
  canInvite: boolean | null;
  chainName: (id?: number) => string;
  onChange: (patch: CardPatch) => void;
  onDetails: () => void;
  detailsOpen: boolean;
  /** the launch button */
  action: ReactNode;
  /** what launching still needs, under the button */
  note?: ReactNode;
}) {
  const grant = tranches.length > 1;
  const people = Math.max(1, Math.min(50, Math.round(Number(slots) || 1)));
  const current = grant ? splitTotal : (tranches[0]?.amount ?? "");

  const setAmount = (v: string) => {
    if (grant) onChange({ splitTotal: v, tranches: tranches.map((t) => ({ ...t, amount: "" })) });
    else onChange({ tranches: tranches.map((t, i) => (i === 0 ? { ...t, amount: v } : t)) });
  };
  const setTranche = (i: number, next: Partial<Tranche>) => onChange({ tranches: tranches.map((t, j) => (j === i ? { ...t, ...next } : t)) });
  const dropCheck = (i: number, k: number) => {
    const t = tranches[i];
    const list = (t.criteria ?? []).filter((_, j) => j !== k);
    setTranche(i, { criteria: list });
  };

  const kindLine = grant
    ? `A grant in ${tranches.length} milestones, each paid when it's done`
    : people > 1
      ? `A bounty for ${people} people`
      : "A gig for one person";
  // each milestone's part: the composer's own mirror of the server's exact split, or the amount it was given
  const share = (i: number): string | null => {
    if (!grant) return null;
    const v = splitTotal.trim() ? shares[i] : tranches[i]?.amount;
    return v && Number(v) > 0 ? `${currencySymbol}${money(Number(v))}` : null;
  };

  return (
    <section className="jc" aria-label="The job">
      <header className="jc-h">
        <h3 className="jc-t">{title}</h3>
        <p className="jc-from">{from ? `From ${from} · ` : ""}{kindLine}</p>
      </header>

      <div className="jc-rows">
        <span className="jc-k">{grant ? "Total" : "Pays"}</span>
        <span className="jc-v">
          <AmountChips
            values={grant ? GRANT_TOTAL : PER_PERSON}
            value={current}
            symbol={currencySymbol}
            onChange={setAmount}
            label={grant ? "Total for the grant" : "What it pays each person"}
            typeOnly={isLocal}
          />
          {!grant && (
            <span className="jc-people">
              <span className="jc-times">×</span>
              <button type="button" className="jc-step" aria-label="One person fewer" disabled={people <= 1} onClick={() => onChange({ slots: String(people - 1) })}><Minus size={13} /></button>
              <span className="mono">{people}</span>
              <button type="button" className="jc-step" aria-label="One person more" disabled={people >= 50} onClick={() => onChange({ slots: String(people + 1) })}><Plus size={13} /></button>
              <span className="jc-times">{people === 1 ? "person" : "people"}</span>
            </span>
          )}
        </span>

        <span className="jc-k">Who</span>
        <span className="jc-v">
          <button type="button" className={`jc-chip${!inviteOnly ? " on" : ""}`} aria-pressed={!inviteOnly} onClick={() => onChange({ inviteOnly: false })}>Anyone, verified</button>
          <button type="button" className={`jc-chip${inviteOnly ? " on" : ""}`} aria-pressed={inviteOnly} onClick={() => onChange({ inviteOnly: true })}>People I invite</button>
          {inviteOnly && canInvite === false && (
            <span className="jc-hint">
              Invite links come with Pro. <a href="/checkout?plan=pro">Upgrade</a>
            </span>
          )}
        </span>
      </div>

      <div className="jc-sec">
        {tranches.map((t, i) => {
          const checks = (t.criteria ?? []).length > 0 ? t.criteria! : t.deliverable.trim() ? [t.deliverable.trim()] : [];
          return (
            <div key={i} className="jc-ms">
              {grant ? (
                <p className="jc-ms-h">
                  <span className="mono jc-n">{String(i + 1).padStart(2, "0")}</span> {(t.title ?? "").trim() || t.deliverable}
                  {share(i) && <span className="mono jc-share">{share(i)}</span>}
                </p>
              ) : (
                <p className="jc-k">Done when</p>
              )}
              <ul className="jc-list">
                {checks.map((c, k) => (
                  <li key={k}>
                    <CircleCheck size={14} aria-hidden />
                    <span>{c}</span>
                    {(t.criteria ?? []).length > 1 && (
                      <button type="button" className="jc-x" aria-label={`Drop the check: ${c}`} onClick={() => dropCheck(i, k)}><X size={12} /></button>
                    )}
                  </li>
                ))}
              </ul>
              {t.verify === "onchain" && !/^0x[0-9a-fA-F]{40}$/.test(t.toAddr.trim()) && (
                <label className="jc-addr">
                  <span>The contract the transaction must go to</span>
                  <input className="mono" type="text" placeholder="0x…" value={t.toAddr} onChange={(e) => setTranche(i, { toAddr: e.target.value })} />
                </label>
              )}
              <p className="jc-checks">{checksLine(t, chainName)}</p>
            </div>
          );
        })}
      </div>

      <footer className="jc-foot">
        <button type="button" className="jc-link" onClick={onDetails} aria-expanded={detailsOpen}>
          {detailsOpen ? "Hide the details" : "Change the details"}
        </button>
        {action}
      </footer>
      {note}
    </section>
  );
}
