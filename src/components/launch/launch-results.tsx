"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Eye } from "lucide-react";
import { MissionCard } from "./mission-card";
import { BudgetBar } from "./budget-bar";
import type { JobView, PlanView } from "./types";
import { friendlyFailure } from "@/lib/launch/failure-copy";
import { rememberInspection } from "@/lib/launch/recent-inspections";
import { LiveBrowserTrail } from "./live-browser-trail";

/**
 * P23 — the founder learns BEFORE funding whether this product's corpus supports autonomous payouts.
 * Derived from the previewed corpus richness (the same key pinned at attach), never a promise. Honest
 * either way: a thin product isn't a failure, it just means the founder confirms payouts themselves.
 */
function CorpusReadinessBadge({ readiness }: { readiness: { sources: number; autonomous: boolean } }) {
  const ready = readiness.autonomous;
  return (
    <div className={`lx-corpus${ready ? " ready" : ""}`}>
      {ready ? <ShieldCheck size={15} /> : <Eye size={15} />}
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
/** The two stages that run AFTER the browser is done — silent, model-driven, and slow enough that a
 *  motionless screen reads as a hang. The designing panel appears only here. */
const DESIGNING = new Set<Stage>(["generating_missions", "reviewing"]);
const RANK: Record<Stage, number> = {
  queued: 0, fetching: 1, field_test: 1.5, analyzing: 2, mapping: 3, generating_missions: 4, reviewing: 5,
  ready: 6, needs_input: 6, failed: 6, superseded: 7,
};
const TERMINAL = new Set<Stage>(["ready", "needs_input", "failed", "superseded"]);
/** Pages that are honest crawl output but poor headline material — sorted last and dimmed. */
const LOW_SURFACE_RE = /terms|privacy|brand-?assets?|licen[cs]e|media-?kit|cookie|legal/i;

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
  docs?: { url: string; title: string; excerpt: string; soughtBecause: string }[];
}

/**
 * When a wall stops Sage, this is the moment a founder most needs to see the work: their product
 * is gated, and the honest question in their head is "did it get anywhere at all?". Saying "I was
 * blocked, so I read your docs to understand what is behind it" is the difference between a plan
 * that looks lazy and one that looks thorough. Silence here reads as failure even when it isn't.
 */
function DocsRead({ docs }: { docs: NonNullable<FieldTestView["docs"]> }) {
  if (docs.length === 0) return null;
  return (
    <div className="lx-note" style={{ marginTop: 12 }}>
      <b>Blocked, so Sage read your documentation.</b> {docs[0].soughtBecause}. It read{" "}
      {docs.map((d, i) => (
        <span key={d.url}>
          {i > 0 ? (i === docs.length - 1 ? " and " : ", ") : ""}
          <a href={d.url} target="_blank" rel="noopener noreferrer">{d.title || d.url}</a>
        </span>
      ))}{" "}
      to understand what is behind the wall. Missions below are designed for a tester who has
      their own account, and Sage never asks anyone for credentials.
    </div>
  );
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
  /**
   * A LIVE CLOCK ON THE THINKING, because a frozen banner reads as a hang no matter what it says.
   * The first real campaign founder watched the filmstrip stop, then a static "takes a minute or
   * two" for several minutes, and concluded Sage was stuck. Nothing here fabricates progress —
   * it is a clock, counting the one thing that is genuinely happening: time Sage has spent on the
   * design passes. Starts when the design phase is first observed, resets if the job leaves it.
   */
  const designSince = useRef<number | null>(null);
  const [designElapsed, setDesignElapsed] = useState(0);
  // Any visit to a plan page teaches THIS browser the way back — links opened from Telegram or a
  // shared message land here too, so remembering on view (not only on create) covers every door.
  useEffect(() => {
    rememberInspection(initial.id, initial.productUrl);
  }, [initial.id, initial.productUrl]);
  useEffect(() => {
    const designing = DESIGNING.has(job.status);
    if (!designing) {
      designSince.current = null;
      return;
    }
    designSince.current ??= Date.now();
    const t = setInterval(() => {
      if (designSince.current) setDesignElapsed(Math.floor((Date.now() - designSince.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [job.status]);
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
          {/* Waiting is optional and the founder must KNOW that — the run is server-side and this
              URL is the durable permalink. Without this line, closing the tab feels like losing
              the work, so founders sit through minutes they didn't need to spend watching. */}
          <p className="lx-comeback">
            You don&apos;t have to wait here — Sage keeps working on our servers. This page is your
            plan&apos;s permanent link; come back anytime, or find it under <b>Your inspections</b> on
            the launch page.
          </p>
          <ul className="lx-stages">
            {STAGE_LABELS.filter((s) => s.key !== "field_test" || job.fieldTestStage).map((s) => {
              const state = RANK[status] > RANK[s.key] ? "done" : RANK[status] === RANK[s.key] ? "active" : "";
              return <li key={s.key} className={`lx-stage ${state}`}><span className="lx-dot" />{s.label}</li>;
            })}
          </ul>
          <LiveBrowserTrail inspectionId={job.id} active={!TERMINAL.has(status)} />
          {job.pagesInspected > 0 && (
            <div className="lx-discover">
              Found <b>{job.pagesInspected}</b> page{job.pagesInspected === 1 ? "" : "s"}
              {job.repoFilesInspected > 0 ? <> · <b>{job.repoFilesInspected}</b> repo files</> : null}
              {job.model ? <> · reviewing with <b>{job.model}</b></> : null}
            </div>
          )}
          {/* THE DESIGN PHASE IS SILENT AND SLOW, and a frozen filmstrip reads as a hang. Once the
              browser is done, the mission model does several sequential passes (draft, review against
              what Sage saw, quality gate, budget split) that take a couple of minutes with nothing new
              to show. This says, honestly, that the browsing is finished and Sage is now thinking —
              turning "is this broken?" into "it's working." No fabricated progress: it appears only
              in the real design stages and states only what already happened. */}
          {DESIGNING.has(status) && (
            <div className="lx-designing" role="status" aria-live="polite">
              <span className="lx-designing-pulse" aria-hidden />
              <span>
                Done exploring{job.pagesInspected > 0 ? <> {hostOf(job.productUrl)}</> : null}. Sage is
                now {status === "reviewing" ? "checking each mission is fair and pays for real work" : "designing missions from what it saw"} — this part is careful and usually takes two to five minutes.
                {designElapsed >= 5 ? <> Working for {Math.floor(designElapsed / 60) > 0 ? `${Math.floor(designElapsed / 60)}m ` : ""}{designElapsed % 60}s.</> : null}
              </span>
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
            <MissionCard key={m.missionKey} mission={m} jobId={job.id} revision={plan.revision} locked={!!job.approval} autonomous={!!job.corpusReadiness?.autonomous} isOnlyMission={plan.missions.length === 1} onSaved={(j) => setJob(j)} />
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
      {/* Legal/brand shells (terms, privacy, brand-assets) are real crawl output but they read as
          "Sage studied the terms page" when they lead the row — product surfaces first, the rest
          only if there's room in the same cap. */}
      {full && map.routes.length > 0 && <div className="lx-map-row"><span className="lx-map-k">Surfaces</span><span className="lx-map-v"><span className="lx-chips">{[...map.routes].sort((a, b) => Number(LOW_SURFACE_RE.test(a.value)) - Number(LOW_SURFACE_RE.test(b.value))).slice(0, 10).map((r, i) => <span className="lx-chip" key={i} style={LOW_SURFACE_RE.test(r.value) ? { opacity: 0.55 } : undefined}>{r.value}</span>)}</span></span></div>}
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
      {ft.docs && <DocsRead docs={ft.docs} />}
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
      {ft.docs && <DocsRead docs={ft.docs} />}
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
        className="lx-textarea"
        placeholder="Answer Sage’s question — e.g. the specific outcome a tester should prove — and Sage will re-plan."
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={3}
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

function hostOf(u: string): string { try { return new URL(u).host; } catch { return u; } }
