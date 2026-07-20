"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Eye } from "lucide-react";
import { MissionCard } from "./mission-card";
import { BudgetBar } from "./budget-bar";
import type { JobView, PlanView } from "./types";

/**
 * P23 — the founder learns BEFORE funding whether this product's corpus supports autonomous payouts.
 * Derived from the previewed corpus richness (the same key pinned at attach), never a promise. Honest
 * either way: a thin product isn't a failure, it just means the founder confirms payouts themselves.
 */
function CorpusReadinessBadge({ readiness }: { readiness: { sources: number; autonomous: boolean } }) {
  const ready = readiness.autonomous;
  return (
    <div
      style={{
        display: "flex", alignItems: "flex-start", gap: 8, margin: "0 0 12px", padding: "10px 12px",
        borderRadius: 10, fontSize: 13, lineHeight: 1.5,
        border: `1px solid ${ready ? "var(--pos, #15803d)" : "var(--warn, #b45309)"}`,
        background: ready ? "var(--pos-soft, rgba(21,128,61,0.06))" : "var(--warn-soft, rgba(180,83,9,0.06))",
      }}
    >
      {ready ? <ShieldCheck size={15} style={{ color: "var(--pos, #15803d)", flexShrink: 0, marginTop: 1 }} />
             : <Eye size={15} style={{ color: "var(--warn, #b45309)", flexShrink: 0, marginTop: 1 }} />}
      <span>
        {ready ? (
          <><b>Rich enough for autonomous payouts.</b> Sage explored this product itself and pinned {readiness.sources} distinct
          things it saw — enough to verify a tester&apos;s firsthand account and pay it automatically.</>
        ) : (
          <><b>This product will need your review.</b> Sage could only pin {readiness.sources} distinct firsthand thing
          {readiness.sources === 1 ? "" : "s"} — too thin to auto-verify, so you&apos;ll confirm observation payouts yourself. Everything else works the same.</>
        )}
      </span>
    </div>
  );
}

/**
 * The durable results view for /launch/[inspectionId]. SEEDED server-side with the job,
 * so a refresh, direct open, or back/forward renders immediately from persisted state —
 * no client-only flag. While running it polls the durable job for TRUE stage
 * transitions; when ready it renders the product map + editable plan + durable approval.
 */

type Stage = JobView["status"];
const STAGE_LABELS: { key: Stage; label: string }[] = [
  { key: "fetching", label: "Checking the product" },
  { key: "field_test", label: "Using your product in a real browser" },
  { key: "analyzing", label: "Reviewing repository context" },
  { key: "mapping", label: "Mapping key pages and flows" },
  { key: "generating_missions", label: "Designing testing missions" },
  { key: "reviewing", label: "Checking mission quality and budget" },
];
const RANK: Record<Stage, number> = {
  queued: 0, fetching: 1, field_test: 1.5, analyzing: 2, mapping: 3, generating_missions: 4, reviewing: 5,
  ready: 6, needs_input: 6, failed: 6, superseded: 7,
};
const TERMINAL = new Set<Stage>(["ready", "needs_input", "failed", "superseded"]);

interface FieldTestView {
  ran: boolean;
  mode?: "static" | "interactive";
  classification?: string | null;
  pages: {
    url: string; title: string; jsOnly: boolean;
    consoleErrors: string[]; brokenRequests: { url: string; status: number }[]; screenshot: string | null;
  }[];
  states?: {
    trigger: string; screenshot: string | null; visibleTextExcerpt: string; url: string;
    notableElements: { tag: string; text: string; role: string }[];
  }[];
}
interface MapView {
  productName: string; category: string; valueProp: string; founderTargetUsers: string;
  routes: { value: string }[]; primaryJourney: { value: string }[]; limitations: string[];
  openQuestions: string[]; pagesInspected: number; repoFilesInspected: number;
  fieldTest?: FieldTestView | null;
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
            {STAGE_LABELS.filter((s) => s.key !== "field_test" || job.fieldTestStage).map((s) => {
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
          <AnswerBox jobId={job.id} onDone={(j) => setJob(j)} onScheduled={() => { if (!poll.current) poll.current = setInterval(refresh, 2000); }} />
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

      {status === "ready" && map?.fieldTest?.ran && <FieldTestStrip ft={map.fieldTest} />}

      {plan && plan.missions.length > 0 && (
        <section aria-label="Mission plan" style={{ marginTop: 22 }}>
          <div className="lx-kicker" style={{ margin: "0 0 6px" }}>Sage designed these missions from what it found</div>
          {status === "ready" && job.corpusReadiness?.observation && (
            <CorpusReadinessBadge readiness={job.corpusReadiness} />
          )}
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

function FieldTestStrip({ ft }: { ft: FieldTestView }) {
  return ft.mode === "interactive" ? <InteractiveFieldTest ft={ft} /> : <StaticFieldTest ft={ft} />;
}

/** Interactive apps (games, canvas experiences, thin SPAs): Sage USED it — show the state log. */
function InteractiveFieldTest({ ft }: { ft: FieldTestView }) {
  const states = ft.states ?? [];
  const shots = states.filter((s) => s.screenshot);
  return (
    <section className="lx-card pad-lg lx-field" aria-label="Field test" style={{ marginTop: 16 }}>
      <div className="lx-kicker" style={{ marginBottom: 8 }}>Sage used your product</div>
      <p className="lx-sub" style={{ fontSize: 14, margin: "0 0 10px" }}>
        This isn’t a static page — it’s a live app. So Sage <b>used</b> it: it waited out loading, then interacted step by step, capturing each state it actually reached.
      </p>
      {ft.classification && (
        <div className="lx-finds" style={{ marginBottom: 12 }}>
          <span className="lx-find ok">{ft.classification}</span>
        </div>
      )}
      {shots.length > 0 && (
        <div className="lx-shots">
          {shots.map((s, i) => (
            <a key={i} className="lx-shot" href={s.screenshot ?? undefined} target="_blank" rel="noopener noreferrer" title={s.trigger}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.screenshot ?? ""} alt={s.trigger} loading="lazy" />
              <span className="lx-shot-cap">{s.trigger}</span>
            </a>
          ))}
        </div>
      )}
      {states.length > 0 && (
        <details className="lx-field-details">
          <summary>The states Sage reached ({states.length})</summary>
          {states.map((s, i) => (
            <div key={i} className="lx-field-line">
              <b>{s.trigger}</b>{s.visibleTextExcerpt ? ` — ${s.visibleTextExcerpt.slice(0, 140)}` : ""}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}

/** Content sites: the multi-page crawl (unchanged). */
function StaticFieldTest({ ft }: { ft: FieldTestView }) {
  const shots = ft.pages.filter((p) => p.screenshot);
  const consoleErrors = ft.pages.reduce((n, p) => n + p.consoleErrors.length, 0);
  const broken = ft.pages.reduce((n, p) => n + p.brokenRequests.length, 0);
  const jsOnly = ft.pages.filter((p) => p.jsOnly).length;
  const errorSamples = ft.pages.flatMap((p) => p.consoleErrors).slice(0, 3);
  const brokenSamples = ft.pages.flatMap((p) => p.brokenRequests).slice(0, 3);
  return (
    <section className="lx-card pad-lg lx-field" aria-label="Field test" style={{ marginTop: 16 }}>
      <div className="lx-kicker" style={{ marginBottom: 8 }}>Sage used your product</div>
      <p className="lx-sub" style={{ fontSize: 14, margin: "0 0 12px" }}>
        Sage opened {ft.pages.length} page{ft.pages.length === 1 ? "" : "s"} in a real browser and captured what a visitor actually sees.
      </p>
      {shots.length > 0 && (
        <div className="lx-shots">
          {shots.map((p, i) => (
            <a key={i} className="lx-shot" href={p.screenshot ?? undefined} target="_blank" rel="noopener noreferrer" title={p.title || p.url}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.screenshot ?? ""} alt={p.title || p.url} loading="lazy" />
              <span className="lx-shot-cap">{p.title || pathOf(p.url)}</span>
            </a>
          ))}
        </div>
      )}
      <div className="lx-finds">
        <span className={`lx-find ${consoleErrors ? "bad" : "ok"}`}>{consoleErrors} console error{consoleErrors === 1 ? "" : "s"}</span>
        <span className={`lx-find ${broken ? "bad" : "ok"}`}>{broken} broken request{broken === 1 ? "" : "s"}</span>
        <span className={`lx-find ${jsOnly ? "warn" : "ok"}`}>{jsOnly} JavaScript-only page{jsOnly === 1 ? "" : "s"}</span>
      </div>
      {(errorSamples.length > 0 || brokenSamples.length > 0) && (
        <details className="lx-field-details">
          <summary>What Sage saw</summary>
          {errorSamples.map((e, i) => <div key={`e${i}`} className="lx-field-line">console: {e}</div>)}
          {brokenSamples.map((b, i) => <div key={`b${i}`} className="lx-field-line">HTTP {b.status || "failed"}: {b.url}</div>)}
        </details>
      )}
    </section>
  );
}

function pathOf(u: string): string {
  try { const x = new URL(u); return x.pathname === "/" ? x.host : x.pathname; } catch { return u; }
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

/** Answer Sage's needs_input question(s); Sage folds the answer into the goal and re-plans. */
function AnswerBox({ jobId, onDone, onScheduled }: { jobId: string; onDone: (j: JobView) => void; onScheduled: () => void }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ marginTop: 14 }}>
      <textarea
        placeholder="Answer Sage’s question — e.g. the specific outcome a tester should prove — and Sage will re-plan."
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={3}
        style={{ width: "100%", resize: "vertical", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border, #e5e5e0)", fontFamily: "inherit", fontSize: 14, background: "var(--paper, #fff)", color: "inherit" }}
      />
      <button className="lx-btn" disabled={busy || !answer.trim()} style={{ marginTop: 8 }} onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/launch/${jobId}/clarify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer }) });
          const data = await res.json();
          if (data.ok) { onDone(data.job as JobView); if (data.replanned) { onScheduled(); setAnswer(""); } }
        } catch { /* ignore */ }
        setBusy(false);
      }}>{busy ? "Re-planning…" : "Answer & re-plan"}</button>
    </div>
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
