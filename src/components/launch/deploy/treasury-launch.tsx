"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Landmark, Loader2, Sparkles } from "lucide-react";
import { UpgradeLink } from "@/components/plans/upgrade-link";
import { isPausedNetwork } from "@/lib/deputy/networks";
import type { PlanId } from "@/lib/plans/catalog";
import { launchReadiness, nativeAmount } from "@/lib/treasury/launch-readiness";

interface Account { chainId: number; network: string; address: string; isMainnet: boolean }
interface Status { linked: boolean; address?: string; balanceUsd?: number; enoughGas?: boolean | null; perCampaignCapUsd?: number; chainId?: number; network?: string; isMainnet?: boolean; nativeSymbol?: string; gasWei?: string | null; launchFloorWei?: string; canSwap?: boolean; accounts?: Account[]; available?: boolean; reason?: string | null; error?: string }

interface Launched { campaignId: string; url: string; steps: { step: string; explorerUrl: string }[] }

/** What stands before a launch door, when no account can be shown yet. */
type Gate = { kind: "signed-out" } | { kind: "no-account"; chainId: number; network: string };

/**
 * "LET SAGE LAUNCH IT." The ONE way a plan launches (26 Oct 2026): one click and the agent deploys, funds
 * and activates the vault from the founder's account on Metis, inside the mandate. The same door for an
 * email sign-in and a MetaMask one; the refusals are the account's own sentences (cap, balance, gas).
 *
 * Only an account on a network that is open gets a door: one on a paused network (GOAT) or a closed one
 * (Arc, Starknet) keeps its money and its withdrawals on the Account screen, and launches nothing here.
 *
 * THE DOOR IS THE PAGE'S MAIN BUTTON (Demo Day, 10 Oct 2026). A founder signed in by email reached
 * this page with $5 in the account; the door was a small button and the wallet route below it a big
 * "Connect your wallet". On stage the big one got clicked, MetaMask signed in, the email session was
 * replaced, and the account — which belongs to the email identity — vanished from the page. The wallet
 * route is gone now; the door says "Checking your account…" instead of rendering nothing, retries a
 * failed read, and when there is no account yet it opens one right here rather than sending the founder
 * somewhere else.
 */
export function TreasuryLaunch({
  jobId,
  budgetUsd,
  approve,
  hold,
  onLaunched,
}: {
  jobId: string;
  budgetUsd: number;
  /**
   * APPROVE AND LAUNCH, ONE CLICK (28 Oct 2026). A plan Sage designed used to take two buttons: approve it,
   * then launch it from the account. Launching now approves it, and only the revision on screen: a plan
   * changed in another tab since is refused rather than launched.
   */
  approve?: { revision: number };
  /** a reason the plan cannot launch yet (its budget is not fully allocated); the button waits */
  hold?: string | null;
  /** told once the job is live, so the page can say so instead of offering the door again */
  onLaunched?: (campaignId: string) => void;
}) {
  const [doors, setDoors] = useState<Status[] | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [reads, setReads] = useState(0);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // undefined: no plan refusal; null: no plan would help; a plan: the one that lifts it.
  const [upgrade, setUpgrade] = useState<PlanId | null | undefined>(undefined);
  const [done, setDone] = useState<Launched | null>(null);
  // The most Sage may put into one job, for an account opened from this page: at least this job's budget.
  const [cap, setCap] = useState(String(Math.max(50, Math.ceil(budgetUsd))));
  const [opening, setOpening] = useState(false);
  // approved by an earlier click whose launch did not go through: a retry launches, it does not approve twice
  const [approvedHere, setApprovedHere] = useState(false);

  useEffect(() => {
    let live = true;
    const read = async (): Promise<{ doors: Status[]; gate: Gate | null }> => {
      const res = await fetch("/api/treasury", { cache: "no-store" });
      if (res.status === 401) return { doors: [], gate: { kind: "signed-out" } };
      const first = (await res.json()) as Status;
      const others = (first.accounts ?? []).filter((a) => a.chainId !== first.chainId && !isPausedNetwork(a.chainId));
      // one account's read failing must not hide the others
      const rest = await Promise.allSettled(others.map(async (a) => (await (await fetch(`/api/treasury?chainId=${a.chainId}`, { cache: "no-store" })).json()) as Status));
      const found = [first, ...rest.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))].filter((st) => st.linked && !isPausedNetwork(st.chainId));
      const noAccount: Gate | null =
        found.length === 0 && !first.linked && first.available !== false && first.chainId != null && !isPausedNetwork(first.chainId)
          ? { kind: "no-account", chainId: first.chainId, network: first.network ?? "Metis" }
          : null;
      return { doors: found, gate: noAccount };
    };
    (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await read();
          if (live) {
            setDoors(r.doors);
            setGate(r.gate);
          }
          return;
        } catch {
          await new Promise((res) => setTimeout(res, 1500)); // a dropped connection gets one more try
        }
      }
      if (live) setDoors([]);
    })();
    return () => { live = false; };
  }, [reads]);

  if (doors === null) {
    return <p className="lx-sub tl-gap"><Loader2 size={14} className="sage-spin2" /> Checking your account…</p>;
  }

  if (gate?.kind === "signed-out") {
    return (
      <div className="lxd-panel tl-gap">
        <p className="lx-sub"><Landmark size={14} /> Jobs launch from the account Sage keeps for you on Metis. Sign in with your email or MetaMask to launch this plan.</p>
        <div className="ws-nav">
          <button className="lx-btn" onClick={() => window.location.assign(`/start?next=${encodeURIComponent(window.location.pathname)}`)}>Sign in to launch</button>
        </div>
      </div>
    );
  }

  if (gate?.kind === "no-account") {
    const open = async () => {
      setOpening(true);
      setErr(null);
      try {
        const r = await fetch("/api/treasury", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ perCampaignCapUsd: Number(cap) || 50, chainId: gate.chainId }) });
        const j = (await r.json()) as { error?: string };
        if (!r.ok) { setErr(j.error ?? "Could not open the account."); return; }
        setDoors(null);
        setReads((n) => n + 1);
      } catch {
        setErr("Could not reach Sage.");
      } finally {
        setOpening(false);
      }
    };
    return (
      <div className="lxd-panel tl-gap">
        <p className="lx-sub"><Landmark size={14} /> Jobs launch from the account Sage keeps for you on {gate.network}. Open it, add this job&apos;s ${budgetUsd.toFixed(2)}, and Sage launches it in one step.</p>
        <label className="tl-open-cap">
          <span>The most Sage may put into one job. You can change it any time.</span>
          <span className="tl-open-row"><input className="ws-input mono" type="number" min="1" max="10000" step="1" value={cap} onChange={(e) => setCap(e.target.value)} disabled={opening} aria-label="Most per job, in USDC" /><span className="tl-open-unit">USDC per job</span></span>
        </label>
        <div className="ws-nav">
          <button className="lx-btn" onClick={() => void open()} disabled={opening}>
            {opening ? <><Loader2 size={13} className="sage-spin2" /> Opening…</> : `Open your account on ${gate.network}`}
          </button>
        </div>
        {err && <p className="ws-err">{err}</p>}
      </div>
    );
  }

  if (doors.length === 0) {
    return (
      <div className="lxd-panel tl-gap">
        <p className="lx-sub"><Landmark size={14} /> Jobs launch from the account Sage keeps for you on Metis, and it isn&apos;t available on this deployment.</p>
      </div>
    );
  }

  const launch = async (chainId: number | undefined) => {
    setBusy(chainId ?? 0);
    setErr(null);
    try {
      if (approve && !approvedHere) {
        const a = await fetch(`/api/launch/${jobId}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: approve.revision }) });
        const aj = (await a.json()) as { ok?: boolean; error?: string };
        if (!a.ok || !aj.ok) {
          setErr(aj.error ?? "Could not approve the plan.");
          return;
        }
        setApprovedHere(true);
      }
      const r = await fetch(`/api/launch/${jobId}/treasury`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId }) });
      const j = (await r.json()) as Launched & { error?: string; reason?: string; upgradeTo?: PlanId | null };
      if (!r.ok) {
        setErr(j.error ?? "Could not launch from your account.");
        setUpgrade(j.reason === "plan_limit" ? j.upgradeTo ?? null : undefined);
        return;
      }
      setDone(j);
      onLaunched?.(j.campaignId);
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
        const { short, addUsd, overCap, needsFee } = launchReadiness(st, budgetUsd);
        const network = st.network ?? "your account";
        const sym = st.nativeSymbol ?? "gas";
        const hasSomeFee = !!st.gasWei && BigInt(st.gasWei) > BigInt(0);
        const accountHref = `/workspace/account${st.chainId ? `?chain=${st.chainId}&do=` : "?do="}`;
        return (
          <div key={st.chainId ?? "default"} className="tl-door">
            <p className="lx-sub">
              <Landmark size={14} /> Your account on {network} holds ${(st.balanceUsd ?? 0).toFixed(2)} {st.isMainnet === false ? "test " : ""}USDC. This job needs ${budgetUsd.toFixed(2)}.
              {short
                ? ` Add $${addUsd.toFixed(2)} or more to your account.`
                : overCap
                  ? ` Your account puts at most $${st.perCampaignCapUsd?.toFixed(2)} into one job: raise that limit on the Account screen to launch this one.`
                  : needsFee
                    ? ` It also needs about ${nativeAmount(st.launchFloorWei)} ${sym} for network fees, paid from the account.`
                    : " Sage can launch it now, with no wallet steps."}
            </p>
            {(short || needsFee || overCap) && (
              <div className="ws-nav">
                {(short || needsFee) && <Link className="ws-chip accent" href={`${accountHref}add`}>Add money</Link>}
                {needsFee && st.canSwap && hasSomeFee && <Link className="ws-chip" href={`${accountHref}swap`}>Swap USDC to {sym}</Link>}
                {overCap && <Link className="ws-chip" href={st.chainId ? `/workspace/account?chain=${st.chainId}` : "/workspace/account"}>Change the limit</Link>}
              </div>
            )}
            <div className="ws-nav">
              <button className="lx-btn" onClick={() => void launch(st.chainId)} disabled={busy !== null || short || needsFee || overCap || !!hold}>
                {busy === (st.chainId ?? 0) ? (
                  <><Loader2 size={13} className="sage-spin2" /> Sage is launching…</>
                ) : approve && !approvedHere ? (
                  <><Sparkles size={13} /> Approve and launch from your account on {network}</>
                ) : (
                  <><Sparkles size={13} /> Let Sage launch it from your account on {network}</>
                )}
              </button>
              <span className="ws-note tl-flat">Up to ${st.perCampaignCapUsd?.toFixed(2)} per job · unspent returns to you</span>
            </div>
          </div>
        );
      })}
      {hold && <p className="ws-note">{hold}</p>}
      {err && <p className="ws-err">{err}</p>}
      {upgrade !== undefined && <div className="ws-nav"><UpgradeLink to={upgrade} className="sage-btn sage-btn-sm" /></div>}
    </div>
  );
}
