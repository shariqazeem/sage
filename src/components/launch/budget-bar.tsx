"use client";

import { useEffect, useState } from "react";
import { reward, type JobView, type PlanView } from "./types";
import { DeployFlow } from "./deploy/deploy-flow";
import { RailChoice } from "./deploy/rail-choice";
import { useFounderSession } from "@/lib/auth/use-founder-session";
import { StarknetDeployFlow } from "./deploy/starknet-deploy-flow";
import type { SettlementRail } from "@/lib/db/schema";

/**
 * The budget summary + durable approval. Budget arithmetic is exact (the server owns the
 * allocation); the founder can change the total and rebalance. Approval posts to
 * /api/launch/<id>/approve, where the server recomputes + verifies every canonical hash
 * before durably recording it — so approval survives refresh and is never a client flag.
 */
export function BudgetBar({
  plan,
  jobId,
  approval,
  onRevised,
  onApproved,
}: {
  plan: PlanView;
  jobId: string;
  approval: JobView["approval"];
  onRevised: (job: JobView) => void;
  onApproved: (job: JobView) => void;
}) {
  const [editingBudget, setEditingBudget] = useState(false);

  /**
   * WHICH RAIL, REMEMBERED — AND DEFAULTED TO ONE THE FOUNDER CAN ACTUALLY USE.
   *
   * This was plain component state initialised to "evm", so a reload silently discarded an
   * explicit choice and dropped the founder into the EVM flow, which then asked them to install
   * MetaMask. Reported exactly that way, by a founder signed in with a Starknet wallet who had
   * chosen Private-capable a minute earlier.
   *
   * Public stays the default, because receipts are what most campaigns are funded to produce and a
   * privacy default would impose a trade-off nobody asked for. But a founder signed in on Starknet
   * has no EVM wallet at all, so defaulting them to a rail they cannot use is not neutrality — it
   * is a dead end. Their default follows their session; the choice remains theirs either way.
   */
  const founder = useFounderSession();
  const [rail, setRailState] = useState<SettlementRail | null>(null);
  const railKey = `sage.rail.${jobId}`;

  useEffect(() => {
    if (founder.loading || rail !== null) return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(railKey);
    } catch {
      /* storage unavailable — fall through to the default */
    }
    setRailState(
      stored === "starknet" || stored === "evm"
        ? stored
        : founder.chain === "starknet"
          ? "starknet"
          : "evm",
    );
  }, [founder.loading, founder.chain, rail, railKey]);

  const setRail = (next: SettlementRail) => {
    setRailState(next);
    try {
      window.localStorage.setItem(railKey, next);
    } catch {
      /* the choice still applies to this page view */
    }
  };
  const [budgetUsd, setBudgetUsd] = useState((Number(plan.totalBudgetBase) / 1e6).toString());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = Number(plan.totalBudgetBase);
  const allocated = plan.missions.reduce((s, m) => s + Number(m.rewardBase) * Number(m.maxCompletions), 0);
  const remaining = total - allocated;
  const completions = plan.missions.reduce((s, m) => s + Number(m.maxCompletions), 0);
  const locked = !!approval;

  const rebalance = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/launch/${jobId}/revise`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: plan.revision, edits: [], newBudgetUsd: budgetUsd }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? "Could not update the budget."); setBusy(false); return; }
      onRevised(data.job as JobView);
      setEditingBudget(false);
    } catch { setError("Could not update the budget."); }
    setBusy(false);
  };

  const approve = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/launch/${jobId}/approve`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: plan.revision }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? "Could not approve — reload and try again."); setBusy(false); return; }
      // Pin the rail that was in effect AT APPROVAL. The choice is frozen from here on, so if it
      // were not written now, a founder who accepted the default and then reloaded would be handed
      // whatever the default happened to be on the next page load — with the control disabled and
      // no way to correct it.
      if (rail) setRail(rail);
      onApproved(data.job as JobView);
    } catch { setError("Could not approve. Please try again."); }
    setBusy(false);
  };

  return (
    <section className="lx-card pad-lg" aria-label="Budget and approval" style={{ marginTop: 22 }}>
      {locked ? (
        <div className="lx-ready-banner"><span aria-hidden>✓</span> You approved this plan · ready to fund</div>
      ) : (
        <div className="lx-ready-banner lx-review-banner"><span aria-hidden>›</span> Sage&rsquo;s plan passed its checks · ready for your review</div>
      )}

      <div className="lx-kicker" style={{ margin: "8px 0 14px" }}>Budget</div>
      <div className="lx-sum">
        <div><div className="lx-sum-k">Total budget</div><div className="lx-sum-v">{reward(total)}</div></div>
        <div><div className="lx-sum-k">Allocated</div><div className="lx-sum-v">{reward(allocated)}</div></div>
        <div><div className="lx-sum-k">Unallocated</div><div className="lx-sum-v" style={{ color: remaining === 0 ? "var(--lx-pos)" : "var(--lx-warn)" }}>{reward(remaining)}</div></div>
        <div><div className="lx-sum-k">Missions · completions</div><div className="lx-sum-v">{plan.missions.length} · {completions}</div></div>
      </div>

      {!locked && (
        editingBudget ? (
          <div className="lx-next" style={{ marginTop: 14, alignItems: "flex-end" }}>
            <div className="lx-field" style={{ margin: 0, maxWidth: 180 }}>
              <label className="lx-label">New total (USDC)</label>
              <input className="lx-input" type="number" min="0.5" step="0.5" value={budgetUsd} onChange={(e) => setBudgetUsd(e.target.value)} />
            </div>
            <button className="lx-btn" onClick={rebalance} disabled={busy}>{busy ? "Rebalancing…" : "Rebalance exactly"}</button>
            <button className="lx-btn ghost" onClick={() => setEditingBudget(false)} disabled={busy}>Cancel</button>
          </div>
        ) : (
          <button className="lx-edit-link" style={{ marginTop: 12 }} onClick={() => setEditingBudget(true)}>Change budget & rebalance</button>
        )
      )}

      <div className="lx-kicker" style={{ margin: "22px 0 10px" }}>Approve</div>
      <p className="lx-approve-note">
        <b>Approve this plan once.</b> Sage can then coordinate, verify, and pay work inside these limits. The campaign
        vault enforces the mission rewards, completion caps, total budget, velocity, and replay protection — Sage
        cannot exceed them.
      </p>

      {/* Asked BEFORE the money, because it decides whether the payments this founder funds are
          public — and that is genuinely theirs to answer, unlike the chain it implies. */}
      <div className="lx-kicker" style={{ margin: "18px 0 4px" }}>How this campaign pays</div>
      <RailChoice value={rail ?? "evm"} onChange={setRail} disabled={locked} />

      {!locked ? (
        <button className="lx-btn" onClick={approve} disabled={busy || remaining !== 0}>{busy ? "Approving…" : "Approve mission plan"}</button>
      ) : rail === "starknet" ? (
        <StarknetDeployFlow jobId={jobId} plan={plan} />
      ) : (
        <DeployFlow jobId={jobId} plan={plan} />
      )}
      {error && <div className="lx-err" role="alert" style={{ marginTop: 10 }}>{error}</div>}
    </section>
  );
}
