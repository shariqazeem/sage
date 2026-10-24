"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Landmark, Loader2, Sparkles } from "lucide-react";
import { UpgradeLink } from "@/components/plans/upgrade-link";
import type { PlanId } from "@/lib/plans/catalog";

interface Account { chainId: number; network: string; address: string; isMainnet: boolean }
interface Status { linked: boolean; address?: string; balanceUsd?: number; enoughGas?: boolean | null; perCampaignCapUsd?: number; chainId?: number; network?: string; isMainnet?: boolean; nativeSymbol?: string; gasWei?: string | null; launchFloorWei?: string; canSwap?: boolean; accounts?: Account[] }

/** "0.05": a wei amount in plain digits for a sentence. */
const native = (wei: string | undefined | null) => {
  if (!wei) return "a little";
  const n = Number(BigInt(wei)) / 1e18;
  return n >= 0.01 ? n.toFixed(2).replace(/0$/, "") : n.toPrecision(2);
};
interface Launched { campaignId: string; url: string; steps: { step: string; explorerUrl: string }[] }

/**
 * "LET SAGE LAUNCH IT." When the founder has an account, the wallet-driven deploy below is optional:
 * one click and the agent deploys, funds and activates the vault from the account, inside the
 * mandate. The refusals are the account's own sentences (cap, balance, gas).
 *
 * One door per account: a founder holding an account on GOAT and one on Arc sees both, each naming
 * its chain and balance.
 *
 * THE DOOR IS THE PAGE'S MAIN BUTTON (Demo Day, 10 Oct 2026). A founder signed in by email reached
 * this page with $5 in the account; the door was a small button and the wallet route below it a big
 * "Connect your wallet". On stage the big one got clicked, MetaMask signed in, the email session was
 * replaced, and the account — which belongs to the email identity — vanished from the page. So the
 * door renders large, reports its state up (DeployFlow folds the wallet route away while an account
 * can launch), says "Checking your account…" instead of rendering nothing, and retries a failed read.
 */
export function TreasuryLaunch({ jobId, budgetUsd, onState }: { jobId: string; budgetUsd: number; onState?: (s: { loading: boolean; hasDoor: boolean }) => void }) {
  const [doors, setDoors] = useState<Status[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // undefined: no plan refusal; null: no plan would help; a plan: the one that lifts it.
  const [upgrade, setUpgrade] = useState<PlanId | null | undefined>(undefined);
  const [done, setDone] = useState<Launched | null>(null);

  useEffect(() => {
    let live = true;
    const read = async (): Promise<Status[]> => {
      const first = (await (await fetch("/api/treasury", { cache: "no-store" })).json()) as Status;
      const others = (first.accounts ?? []).filter((a) => a.chainId !== first.chainId);
      // one account's read failing must not hide the others
      const rest = await Promise.allSettled(others.map(async (a) => (await (await fetch(`/api/treasury?chainId=${a.chainId}`, { cache: "no-store" })).json()) as Status));
      return [first, ...rest.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))].filter((st) => st.linked);
    };
    (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const found = await read();
          if (live) setDoors(found);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 1500)); // a dropped connection gets one more try
        }
      }
      if (live) setDoors([]);
    })();
    return () => { live = false; };
  }, []);

  // "hasDoor" means a door that can LAUNCH this plan now: an account that is short of the budget or of
  // gas still renders (with its own sentence), but it must not fold the wallet route away.
  useEffect(() => {
    const canLaunch = (doors ?? []).some((d) => (d.balanceUsd ?? 0) >= budgetUsd && d.enoughGas !== false);
    onState?.({ loading: doors === null, hasDoor: canLaunch });
  }, [doors, onState, budgetUsd]);

  if (doors === null) {
    return <p className="lx-sub tl-gap"><Loader2 size={14} className="sage-spin2" /> Checking your account…</p>;
  }
  if (doors.length === 0) return null;

  const launch = async (chainId: number | undefined) => {
    setBusy(chainId ?? 0);
    setErr(null);
    try {
      const r = await fetch(`/api/launch/${jobId}/treasury`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId }) });
      const j = (await r.json()) as Launched & { error?: string; reason?: string; upgradeTo?: PlanId | null };
      if (!r.ok) {
        setErr(j.error ?? "Could not launch from your account.");
        setUpgrade(j.reason === "plan_limit" ? j.upgradeTo ?? null : undefined);
        return;
      }
      setDone(j);
    } catch {
      setErr("Network error — try again.");
    } finally {
      setBusy(null);
    }
  };

  if (done) {
    return (
      <div className="lxd-panel tl-gap">
        <p className="lx-sub"><Sparkles size={14} /> Sage deployed, funded and activated the vault from your account. The job is live.</p>
        <div className="ws-nav tl-top">
          <Link className="sage-btn sage-btn-primary sage-btn-sm" href={`/campaign/${done.campaignId}`}>Open the console <ArrowUpRight size={13} /></Link>
          <a className="ws-chip" href={done.url} target="_blank" rel="noopener noreferrer">the board</a>
          {done.steps.map((s) => <a key={s.step} className="ws-chip" href={s.explorerUrl} target="_blank" rel="noopener noreferrer">{s.step} tx</a>)}
        </div>
      </div>
    );
  }

  return (
    <div className="lxd-panel tl-gap">
      {doors.map((st) => {
        const short = st.balanceUsd !== undefined && st.balanceUsd < budgetUsd;
        const needsFee = st.enoughGas === false;
        const network = st.network ?? "your account";
        const sym = st.nativeSymbol ?? "gas";
        const hasSomeFee = !!st.gasWei && BigInt(st.gasWei) > BigInt(0);
        const accountHref = `/workspace/account${st.chainId ? `?chain=${st.chainId}&do=` : "?do="}`;
        return (
          <div key={st.chainId ?? "default"} className="tl-door">
            <p className="lx-sub">
              <Landmark size={14} /> Your account on {network} holds ${(st.balanceUsd ?? 0).toFixed(2)} {st.isMainnet === false ? "test " : ""}USDC. This job needs ${budgetUsd.toFixed(2)}.
              {short
                ? ` Add $${(budgetUsd - (st.balanceUsd ?? 0)).toFixed(2)} or more, or fund it from your wallet below.`
                : needsFee
                  ? ` It also needs about ${native(st.launchFloorWei)} ${sym} for network fees, paid from the account.`
                  : " Sage can launch it now, with no wallet steps."}
            </p>
            {(short || needsFee) && (
              <div className="ws-nav">
                <Link className="ws-chip accent" href={`${accountHref}add`}>Add money</Link>
                {needsFee && st.canSwap && hasSomeFee && <Link className="ws-chip" href={`${accountHref}swap`}>Swap USDC to {sym}</Link>}
              </div>
            )}
            <div className="ws-nav">
              <button className="lx-btn" onClick={() => void launch(st.chainId)} disabled={busy !== null || short || needsFee}>
                {busy === (st.chainId ?? 0) ? <><Loader2 size={13} className="sage-spin2" /> Sage is launching…</> : <><Sparkles size={13} /> Let Sage launch it from your account on {network}</>}
              </button>
              <span className="ws-note tl-flat">Up to ${st.perCampaignCapUsd?.toFixed(2)} per job · unspent returns to you</span>
            </div>
          </div>
        );
      })}
      {err && <p className="ws-err">{err}</p>}
      {upgrade !== undefined && <div className="ws-nav"><UpgradeLink to={upgrade} className="sage-btn sage-btn-sm" /></div>}
    </div>
  );
}
