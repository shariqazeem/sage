"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The founder Launch workspace. Five progressive steps: describe → real inspection
 * progress → product map → mission plan → approval. It drives the REAL pipeline via
 * /api/launch and polls the durable job for TRUE stage transitions (never a timer).
 * Nothing here fabricates progress or data.
 */

type Stage =
  | "queued" | "fetching" | "analyzing" | "mapping" | "generating_missions"
  | "reviewing" | "ready" | "needs_input" | "failed" | "superseded";

interface Finding { value: string }
interface MapView {
  productName: string; category: string; valueProp: string; founderTargetUsers: string;
  routes: Finding[]; primaryJourney: Finding[]; trustSurfaces: Finding[]; interactiveSurfaces: Finding[];
  limitations: string[]; openQuestions: string[]; pagesInspected: number; repoFilesInspected: number; digest: string;
}
interface MissionView {
  missionKey: string; title: string; objective: string; instructions: string; targetSurface: string;
  criteria: string[]; evidenceRequirements: string[]; whyItMatters: string; verificationMethod: string;
  sources: { kind: string; ref: string }[]; riskCategory: string; priority: string; effortMinutes: number;
  rewardBase: string; maxCompletions: string;
}
interface PlanView {
  publicCampaignId: string; campaignIdHash: string; missionPlanDigest: string;
  missions: MissionView[]; totalBudgetBase: string; allocatedBase: string;
}
interface ResultView {
  stage: Stage; reason: string | null; map: MapView | null; plan: PlanView | null; questions: string[];
}
interface JobView {
  id: string; status: Stage; productUrl: string; pagesInspected: number; repoFilesInspected: number;
  model: string | null; provider: string | null; failureReason: string | null; result: ResultView | null;
}

const STAGE_LABELS: { key: Stage; label: string }[] = [
  { key: "fetching", label: "Checking the product" },
  { key: "analyzing", label: "Reviewing repository context" },
  { key: "mapping", label: "Mapping key pages and flows" },
  { key: "generating_missions", label: "Designing testing missions" },
  { key: "reviewing", label: "Checking mission quality and budget" },
];
const RANK: Record<Stage, number> = {
  queued: 0, fetching: 1, analyzing: 2, mapping: 3, generating_missions: 4, reviewing: 5,
  ready: 6, needs_input: 6, failed: 6, superseded: 7,
};
const TERMINAL = new Set<Stage>(["ready", "needs_input", "failed", "superseded"]);
const usd = (base: string) => `$${(Number(base) / 1e6).toFixed(2)}`;
const short = (h: string) => (h.length > 16 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h);

export function LaunchWorkspace() {
  const [form, setForm] = useState({ productUrl: "", repoUrl: "", goal: "", targetUsers: "", budgetUsd: "5" });
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [approved, setApproved] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = () => { if (poll.current) { clearInterval(poll.current); poll.current = null; } };

  const fetchJob = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/launch/${id}`, { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setJob(data.job as JobView);
        if (TERMINAL.has((data.job as JobView).status)) stopPoll();
      }
    } catch { /* keep polling */ }
  }, []);

  useEffect(() => () => stopPoll(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? "Something went wrong."); setSubmitting(false); return; }
      const id = data.job.id as string;
      setJobId(id);
      setJob(data.job as JobView);
      stopPoll();
      poll.current = setInterval(() => fetchJob(id), 2000);
    } catch {
      setError("Could not reach Sage. Please try again.");
    }
    setSubmitting(false);
  };

  const reset = () => { stopPoll(); setJobId(null); setJob(null); setApproved(false); setError(null); };

  // ── Step 1: describe the launch ─────────────────────────────────────────
  if (!jobId) {
    return (
      <form className="lx-card pad-lg" onSubmit={submit}>
        <div className="lx-field">
          <label className="lx-label" htmlFor="url">Product URL</label>
          <input id="url" className="lx-input" type="url" required placeholder="https://yourproduct.com"
            value={form.productUrl} onChange={(e) => setForm({ ...form, productUrl: e.target.value })} />
          <div className="lx-hint">A public page Sage can open. Sage only reads it — it never signs in, buys, or changes anything.</div>
        </div>
        <div className="lx-field">
          <label className="lx-label" htmlFor="repo">Public GitHub repository <span style={{ color: "var(--lx-muted)", fontWeight: 400 }}>· optional</span></label>
          <input id="repo" className="lx-input" type="url" placeholder="https://github.com/you/project"
            value={form.repoUrl} onChange={(e) => setForm({ ...form, repoUrl: e.target.value })} />
        </div>
        <div className="lx-field">
          <label className="lx-label" htmlFor="goal">What are you launching or trying to learn?</label>
          <textarea id="goal" className="lx-textarea" required placeholder="e.g. We just shipped a new onboarding — I want to know if a first-time user can reach the dashboard without getting stuck."
            value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} />
        </div>
        <div className="lx-row">
          <div className="lx-field">
            <label className="lx-label" htmlFor="users">Target users</label>
            <input id="users" className="lx-input" required placeholder="e.g. non-technical founders"
              value={form.targetUsers} onChange={(e) => setForm({ ...form, targetUsers: e.target.value })} />
          </div>
          <div className="lx-field">
            <label className="lx-label" htmlFor="budget">Testing budget (USDC)</label>
            <input id="budget" className="lx-input" type="number" min="0.5" step="0.5" required
              value={form.budgetUsd} onChange={(e) => setForm({ ...form, budgetUsd: e.target.value })} />
            <div className="lx-hint">Sage allocates this exactly across the missions it designs.</div>
          </div>
        </div>
        <button className="lx-btn" type="submit" disabled={submitting}>
          {submitting ? "Starting…" : "Let Sage inspect"}
          <span aria-hidden>→</span>
        </button>
        {error && <div className="lx-err" role="alert">{error}</div>}
      </form>
    );
  }

  const status = job?.status ?? "queued";
  const result = job?.result ?? null;
  const map = result?.map ?? null;
  const plan = result?.plan ?? null;

  // ── terminal: needs_input / failed ──────────────────────────────────────
  if (status === "failed") {
    return (
      <div className="lx-card pad-lg">
        <div className="lx-h1" style={{ fontSize: 22 }}>Sage couldn’t finish this one</div>
        <p className="lx-sub" style={{ fontSize: 15 }}>{job?.failureReason ?? result?.reason ?? "The inspection did not complete."}</p>
        <button className="lx-btn ghost" onClick={reset} style={{ marginTop: 16 }}>Try another product</button>
      </div>
    );
  }

  return (
    <div>
      {/* Step 2: real progress */}
      {!TERMINAL.has(status) && (
        <div className="lx-card pad-lg">
          <div className="lx-kicker" style={{ marginBottom: 6 }}>Inspecting {new URL(job?.productUrl ?? "https://x").host}</div>
          <ul className="lx-stages">
            {STAGE_LABELS.map((s) => {
              const state = RANK[status] > RANK[s.key] ? "done" : RANK[status] === RANK[s.key] ? "active" : "";
              return (
                <li key={s.key} className={`lx-stage ${state}`}>
                  <span className="lx-dot" />
                  {s.label}
                </li>
              );
            })}
          </ul>
          {(job?.pagesInspected ?? 0) > 0 && (
            <div className="lx-discover">
              Found <b>{job?.pagesInspected}</b> page{job?.pagesInspected === 1 ? "" : "s"}
              {(job?.repoFilesInspected ?? 0) > 0 ? <> · <b>{job?.repoFilesInspected}</b> repo files</> : null}
              {job?.model ? <> · reviewing with <b>{job.model}</b></> : null}
            </div>
          )}
        </div>
      )}

      {/* needs_input */}
      {status === "needs_input" && (
        <div className="lx-card pad-lg">
          <div className="lx-h1" style={{ fontSize: 22 }}>Sage needs a little more to go on</div>
          {(result?.questions?.length ? result.questions : ["Could Sage reach your product over HTTPS?"]).map((q, i) => (
            <div className="lx-question" key={i}>{q}</div>
          ))}
          <button className="lx-btn ghost" onClick={reset} style={{ marginTop: 12 }}>Adjust and retry</button>
        </div>
      )}

      {/* Step 3: product map */}
      {map && (
        <section className="lx-card pad-lg" aria-label="Product map">
          <div className="lx-kicker" style={{ marginBottom: 12 }}>What Sage found</div>
          <div className="lx-map-row"><span className="lx-map-k">Product</span><span className="lx-map-v"><b>{map.productName}</b> · {map.category}</span></div>
          <div className="lx-map-row"><span className="lx-map-k">Value proposition</span><span className="lx-map-v">{map.valueProp}</span></div>
          {map.primaryJourney.length > 0 && (
            <div className="lx-map-row"><span className="lx-map-k">Primary journey</span><span className="lx-map-v">{map.primaryJourney.map((j) => j.value).join(" → ")}</span></div>
          )}
          <div className="lx-map-row"><span className="lx-map-k">Pages inspected</span><span className="lx-map-v">{map.pagesInspected}{map.repoFilesInspected > 0 ? ` · ${map.repoFilesInspected} repo files` : ""}</span></div>
          {map.routes.length > 0 && (
            <div className="lx-map-row"><span className="lx-map-k">Surfaces</span><span className="lx-map-v"><span className="lx-chips">{map.routes.slice(0, 8).map((r, i) => <span className="lx-chip" key={i}>{r.value}</span>)}</span></span></div>
          )}
          {map.limitations.length > 0 && (
            <div className="lx-note"><b>What Sage could not see:</b> {map.limitations.join(" ")}</div>
          )}
          {map.openQuestions.length > 0 && map.openQuestions.map((q, i) => <div className="lx-question" key={i}>{q}</div>)}
        </section>
      )}

      {/* Step 4: mission plan */}
      {plan && plan.missions.length > 0 && (
        <section aria-label="Mission plan" style={{ marginTop: 22 }}>
          <div className="lx-kicker" style={{ margin: "0 0 6px" }}>Sage’s testing missions</div>
          {plan.missions.map((m) => (
            <article className="lx-mission" key={m.missionKey}>
              <div className="lx-mission-top">
                <h3 className="lx-mission-title">{m.title}</h3>
                <div className="lx-reward">
                  <div className="lx-reward-n">{usd(m.rewardBase)}</div>
                  <div className="lx-reward-s">× {m.maxCompletions} · ~{m.effortMinutes}m</div>
                </div>
              </div>
              <p className="lx-why"><b style={{ color: "var(--lx-ink)", fontWeight: 600 }}>Why Sage created this: </b>{m.whyItMatters}</p>
              <div className="lx-tags">
                <span className="lx-tag">{m.priority}</span>
                <span className="lx-tag">{m.riskCategory.replace(/_/g, " ")}</span>
              </div>
              <details className="lx-detail">
                <summary>See the exact task, evidence, and sources</summary>
                <div className="lx-sub-h">Target</div>
                <div className="lx-src">{m.targetSurface}</div>
                <div className="lx-sub-h">Tester steps</div>
                <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" }}>{m.instructions}</p>
                <div className="lx-sub-h">Counts as complete</div>
                <ul className="lx-list">{m.criteria.map((c, i) => <li key={i}>{c}</li>)}</ul>
                <div className="lx-sub-h">Evidence required</div>
                <ul className="lx-list">{m.evidenceRequirements.map((c, i) => <li key={i}>{c}</li>)}</ul>
                <div className="lx-sub-h">From what Sage observed</div>
                {m.sources.map((s, i) => <div className="lx-src" key={i}>{s.kind}: {s.ref}</div>)}
              </details>
            </article>
          ))}
        </section>
      )}

      {/* Step 5: approval summary */}
      {plan && plan.missions.length > 0 && (
        <section className="lx-card pad-lg" aria-label="Approval" style={{ marginTop: 22 }}>
          {approved && <div className="lx-ready-banner"><span aria-hidden>✓</span> Mission plan ready</div>}
          <div className="lx-kicker" style={{ margin: "6px 0 14px" }}>Approve the plan</div>
          <div className="lx-sum">
            <div><div className="lx-sum-k">Total budget</div><div className="lx-sum-v">{usd(plan.totalBudgetBase)}</div></div>
            <div><div className="lx-sum-k">Allocated (exact)</div><div className="lx-sum-v">{usd(plan.allocatedBase)}</div></div>
            <div><div className="lx-sum-k">Missions</div><div className="lx-sum-v">{plan.missions.length}</div></div>
            <div><div className="lx-sum-k">Possible completions</div><div className="lx-sum-v">{plan.missions.reduce((s, m) => s + Number(m.maxCompletions), 0)}</div></div>
          </div>
          <p className="lx-approve-note">
            <b>You approve this plan once.</b> After that, Sage’s Deputy verifies each tester’s work against these
            exact criteria and pays the reward from an on-chain vault — every payout still passes six on-chain checks
            the Deputy cannot change. The mission wording Sage evaluated is an application-level record; the vault
            enforces the mission identities, rewards, and completion caps.
          </p>
          {!approved ? (
            <button className="lx-btn" onClick={() => setApproved(true)}>Approve this plan</button>
          ) : (
            <div className="lx-next">
              <button className="lx-btn" disabled>Create and fund the campaign vault</button>
              <span className="lx-badge-next">next</span>
            </div>
          )}
          <div className="lx-next" style={{ marginTop: 14 }}>
            <button className="lx-btn ghost" onClick={reset}>Start over</button>
          </div>
        </section>
      )}
    </div>
  );
}
