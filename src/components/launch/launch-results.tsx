"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MissionCard } from "./mission-card";
import { BudgetBar } from "./budget-bar";
import type { JobView, PlanView } from "./types";

/**
 * The durable results view for /launch/[inspectionId]. SEEDED server-side with the job,
 * so a refresh, direct open, or back/forward renders immediately from persisted state —
 * no client-only flag. While running it polls the durable job for TRUE stage
 * transitions; when ready it renders the product map + editable plan + durable approval.
 */

type Stage = JobView["status"];
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

interface MapView {
  productName: string; category: string; valueProp: string; founderTargetUsers: string;
  routes: { value: string }[]; primaryJourney: { value: string }[]; limitations: string[];
  openQuestions: string[]; pagesInspected: number; repoFilesInspected: number;
}

export function LaunchResults({ initial }: { initial: JobView }) {
  const router = useRouter();
  const [job, setJob] = useState<JobView>(initial);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => { if (poll.current) { clearInterval(poll.current); poll.current = null; } };

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/launch/${initial.id}`, { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setJob(data.job as JobView);
        if (TERMINAL.has((data.job as JobView).status)) stop();
      }
    } catch { /* keep polling */ }
  }, [initial.id]);

  useEffect(() => {
    if (!TERMINAL.has(job.status)) poll.current = setInterval(refresh, 2000);
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const status = job.status;
  const result = job.result;
  const map = (result?.map as MapView | null) ?? null;
  const plan = job.plan as PlanView | null;

  return (
    <div>
      {!TERMINAL.has(status) && (
        <div className="lx-card pad-lg">
          <div className="lx-kicker" style={{ marginBottom: 6 }}>Inspecting {hostOf(job.productUrl)}</div>
          <ul className="lx-stages">
            {STAGE_LABELS.map((s) => {
              const state = RANK[status] > RANK[s.key] ? "done" : RANK[status] === RANK[s.key] ? "active" : "";
              return <li key={s.key} className={`lx-stage ${state}`}><span className="lx-dot" />{s.label}</li>;
            })}
          </ul>
          {job.pagesInspected > 0 && (
            <div className="lx-discover">
              Found <b>{job.pagesInspected}</b> page{job.pagesInspected === 1 ? "" : "s"}
              {job.repoFilesInspected > 0 ? <> · <b>{job.repoFilesInspected}</b> repo files</> : null}
              {job.model ? <> · reviewing with <b>{job.model}</b></> : null}
            </div>
          )}
        </div>
      )}

      {status === "needs_input" && (
        <div className="lx-card pad-lg">
          <div className="lx-h1" style={{ fontSize: 22 }}>Sage needs a little more to go on</div>
          {(result?.questions?.length ? result.questions : ["Could Sage reach your product over HTTPS?"]).map((q, i) => <div className="lx-question" key={i}>{q}</div>)}
          {map && <MapSummary map={map} />}
          <div className="lx-next" style={{ marginTop: 14 }}>
            <RetryButton jobId={job.id} onDone={(j) => setJob(j)} onScheduled={() => { if (!poll.current) poll.current = setInterval(refresh, 2000); }} />
            <button className="lx-btn ghost" onClick={() => router.push("/launch")}>Adjust inputs</button>
          </div>
        </div>
      )}

      {status === "failed" && (
        <div className="lx-card pad-lg">
          <div className="lx-h1" style={{ fontSize: 22 }}>Sage couldn’t finish this one</div>
          <p className="lx-sub" style={{ fontSize: 15 }}>{friendlyFailure(job.failureReason ?? result?.reason)}</p>
          <div className="lx-src" style={{ marginTop: 10 }}>Reference: {job.id}</div>
          <div className="lx-next" style={{ marginTop: 16 }}>
            <RetryButton jobId={job.id} onDone={(j) => setJob(j)} onScheduled={() => { if (!poll.current) poll.current = setInterval(refresh, 2000); }} />
            <button className="lx-btn ghost" onClick={() => router.push("/launch")}>Start over</button>
          </div>
        </div>
      )}

      {map && status === "ready" && <section className="lx-card pad-lg" aria-label="Product map"><MapSummary map={map} full /></section>}

      {plan && plan.missions.length > 0 && (
        <section aria-label="Mission plan" style={{ marginTop: 22 }}>
          <div className="lx-kicker" style={{ margin: "0 0 6px" }}>Sage designed these missions from what it found</div>
          {plan.missions.map((m) => (
            <MissionCard key={m.missionKey} mission={m} jobId={job.id} revision={plan.revision} locked={!!job.approval} onSaved={(j) => setJob(j)} />
          ))}
        </section>
      )}

      {plan && plan.missions.length > 0 && (
        <BudgetBar plan={plan} jobId={job.id} approval={job.approval} onRevised={(j) => setJob(j)} onApproved={(j) => setJob(j)} />
      )}
    </div>
  );
}

function MapSummary({ map, full }: { map: MapView; full?: boolean }) {
  return (
    <>
      {full && <div className="lx-kicker" style={{ marginBottom: 12 }}>What Sage understood</div>}
      <div className="lx-map-row"><span className="lx-map-k">Product</span><span className="lx-map-v"><b>{map.productName}</b> · {map.category}</span></div>
      <div className="lx-map-row"><span className="lx-map-k">Value proposition</span><span className="lx-map-v">{map.valueProp}</span></div>
      {map.primaryJourney.length > 0 && <div className="lx-map-row"><span className="lx-map-k">Primary journey</span><span className="lx-map-v">{map.primaryJourney.map((j) => j.value).join(" → ")}</span></div>}
      <div className="lx-map-row"><span className="lx-map-k">Pages inspected</span><span className="lx-map-v">{map.pagesInspected}{map.repoFilesInspected > 0 ? ` · ${map.repoFilesInspected} repo files` : ""}</span></div>
      {full && map.routes.length > 0 && <div className="lx-map-row"><span className="lx-map-k">Surfaces</span><span className="lx-map-v"><span className="lx-chips">{map.routes.slice(0, 10).map((r, i) => <span className="lx-chip" key={i}>{r.value}</span>)}</span></span></div>}
      {map.limitations.length > 0 && <div className="lx-note"><b>What Sage could not see:</b> {map.limitations.join(" ")}</div>}
    </>
  );
}

function RetryButton({ jobId, onDone, onScheduled }: { jobId: string; onDone: (j: JobView) => void; onScheduled: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button className="lx-btn" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/launch/${jobId}/retry`, { method: "POST" });
        const data = await res.json();
        if (data.ok) { onDone(data.job as JobView); if (data.retried) onScheduled(); }
      } catch { /* ignore */ }
      setBusy(false);
    }}>{busy ? "Retrying…" : "Try again"}</button>
  );
}

function friendlyFailure(reason?: string | null): string {
  switch (reason) {
    case "llm_not_configured": return "Sage’s reviewer is not configured in this environment.";
    case "invalid_json": case "truncated_output": case "schema_mismatch": return "Sage’s reviewer returned an unusable response. This is usually transient — please try again.";
    case "provider_timeout": case "provider_transient": case "provider_error": return "Sage’s reviewer was briefly unavailable. Please try again.";
    default: return reason ?? "The inspection did not complete.";
  }
}
function hostOf(u: string): string { try { return new URL(u).host; } catch { return u; } }
