"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { reward, type JobView, type PlanView } from "./types";
import { DeployFlow } from "./deploy/deploy-flow";

/**
 * The budget summary, then the launch. Budget arithmetic is exact (the server owns the allocation); the
 * founder can change the total and rebalance. Approval still posts to /api/launch/<id>/approve, where the
 * server recomputes + verifies every canonical hash before durably recording it, so approval survives a
 * refresh and is never a client flag.
 *
 * ONE BUTTON (28 Oct 2026, the founder: "the way it has steps to launch it, that whole flow feels boring
 * and manual"). Approve, then launch, were two buttons for one decision. Launching now approves the plan on
 * screen, and a launched plan says it is live instead of offering the door again.
 */
export function BudgetBar({
  plan,
  jobId,
  approval,
  launched,
  onRevised,
  onLaunched,
}: {
  plan: PlanView;
  jobId: string;
  approval: JobView["approval"];
  launched?: JobView["launched"];
  onRevised: (job: JobView) => void;
  onLaunched?: (campaignId: string) => void;
}) {
  const [editingBudget, setEditingBudget] = useState(false);

  // ONE WAY TO PAY (26 Oct 2026). The founder was asked "public receipts, or private on Starknet?" here;
  // Starknet is closed (networks.ts CLOSED_NETWORKS), so every plan funds the one way: from the account
  // Sage keeps on Metis, with a public receipt for every payout.
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

  return (
    <section className="lx-card pad-lg" aria-label="Budget and approval" style={{ marginTop: 22 }}>
      {launched ? (
        <div className="lx-ready-banner"><span aria-hidden>✓</span> This job is live</div>
      ) : locked ? (
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

      {!locked && !launched && (
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

      <div className="lx-kicker" style={{ margin: "22px 0 10px" }}>Launch</div>
      <p className="lx-approve-note">
        {!locked && !launched && <><b>Launching approves this plan.</b> </>}
        Sage checks the work and pays only inside these limits: the job&apos;s vault enforces the mission rewards,
        completion caps, total budget, velocity and replay protection, and Sage cannot exceed them.
      </p>

      {launched ? (
        <div className="lxd-panel">
          <p className="lx-sub"><Sparkles size={14} /> This job is live. Every payout gets a receipt, and every refusal its reason.</p>
          <div className="ws-nav tl-top">
            <Link className="sage-btn sage-btn-primary sage-btn-sm" href={`/campaign/${launched.campaignId}`}>Open the job <ArrowUpRight size={13} /></Link>
            <a className="ws-chip" href={`/c/${launched.campaignId}`}>the board</a>
          </div>
        </div>
      ) : (
        <DeployFlow
          jobId={jobId}
          plan={plan}
          approve={locked ? undefined : { revision: plan.revision }}
          hold={!locked && remaining !== 0 ? "Part of the budget is not allocated yet. Rebalance it above, then launch." : null}
          onLaunched={onLaunched}
        />
      )}
      {error && <div className="lx-err" role="alert" style={{ marginTop: 10 }}>{error}</div>}
    </section>
  );
}
