"use client";

import { useState } from "react";
import { reward, type JobView, type PlanView } from "./types";
import { DeployFlow } from "./deploy/deploy-flow";

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
      onApproved(data.job as JobView);
    } catch { setError("Could not approve. Please try again."); }
    setBusy(false);
  };

  return (
    <section className="lx-card pad-lg" aria-label="Budget and approval" style={{ marginTop: 22 }}>
      {locked && (
        <div className="lx-ready-banner"><span aria-hidden>✓</span> Mission plan approved · ready to fund</div>
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

      {!locked ? (
        <button className="lx-btn" onClick={approve} disabled={busy || remaining !== 0}>{busy ? "Approving…" : "Approve mission plan"}</button>
      ) : (
        <DeployFlow jobId={jobId} plan={plan} />
      )}
      {error && <div className="lx-err" role="alert" style={{ marginTop: 10 }}>{error}</div>}
    </section>
  );
}
