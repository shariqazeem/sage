"use client";

import { useEffect, useRef, useState } from "react";
import {
  MousePointerClick,
  Eye,
  FileText,
  ShieldAlert,
  PenLine,
  Globe,
  Compass,
} from "lucide-react";

interface TrailStep {
  n: number;
  at?: number;
  label: string;
  screenshot: string | null;
  url: string;
}

/**
 * The KIND of work a step narrates, inferred from its label — purely presentational, so the
 * classification can never affect the run. Each kind gets a verb-appropriate icon: the founder
 * should read "an agent acting", never "pages flipping".
 */
type StepKind = "action" | "wall" | "docs" | "eyes" | "design" | "probe" | "nav";
function stepKind(label: string): StepKind {
  const l = label.toLowerCase();
  if (l.includes("wall")) return "wall";
  if (l.startsWith("read the docs") || l.startsWith("checking ") || l.includes("hunting for public")) return "docs";
  if (l.includes("studying") || l.includes("screenshot") || l.includes("backup eye")) return "eyes";
  if (
    l.includes("designing missions") || l.includes("critic") || l.includes("redesigning") ||
    l.includes("strengthening the plan") || l.includes("missions final") || l.includes("assembling the product map")
  )
    return "design";
  if (l.startsWith("probing controls")) return "probe";
  if (/^(clicked|explored|typed|chose|drew|sent)/.test(l)) return "action";
  return "nav";
}
const KIND_ICON: Record<StepKind, typeof Globe> = {
  action: MousePointerClick,
  wall: ShieldAlert,
  docs: FileText,
  eyes: Eye,
  design: PenLine,
  probe: Compass,
  nav: Globe,
};
function offset(step: TrailStep, first: TrailStep): string {
  if (!step.at || !first.at) return "";
  const s = Math.max(0, Math.round((step.at - first.at) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * WHAT SAGE IS DOING IN THE BROWSER, RIGHT NOW.
 *
 * The browser phase runs for minutes. A founder staring at one motionless line cannot tell work
 * from a hang — and the most interesting thing Sage does is the thing nobody could see. So this
 * shows the screen Sage is looking at, full width, with the action that produced it, and the
 * filmstrip of everything it has done so far. It updates as each state lands.
 *
 * Every frame is a REAL capture: no timers, no predicted steps, nothing rendered before it
 * happened. An empty trail renders nothing at all rather than a placeholder.
 */
export function LiveBrowserTrail({
  inspectionId,
  active,
}: {
  inspectionId: string;
  active: boolean;
}) {
  const [steps, setSteps] = useState<TrailStep[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/field-tests/${inspectionId}/progress`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (alive && data?.ok && Array.isArray(data.steps)) {
          setSteps(data.steps as TrailStep[]);
        }
      } catch {
        /* keep polling — a missing trail is not an error */
      }
    };
    void tick();
    timer.current = setInterval(tick, 1500);
    return () => {
      alive = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [inspectionId, active]);

  if (steps.length === 0) return null;

  const latest = steps[steps.length - 1]!;
  const withShots = steps.filter((s) => s.screenshot);
  // The screen NEVER goes blank: a narration-only step (probing, doc hunt, design phases) keeps
  // the last real capture on screen — that IS the last thing Sage saw, so it stays honest — while
  // the caption narrates the current work.
  const frame = latest.screenshot ? latest : withShots[withShots.length - 1] ?? null;
  // the recent tail, oldest → newest, so the strip reads left to right and ends on "now".
  const strip = withShots.slice(-9);
  let host = "";
  try {
    host = new URL(latest.url || frame?.url || "").host;
  } catch {
    host = "";
  }

  return (
    <div className="lbt">
      <div className="lbt-head">
        <span className="lbt-live" />
        <span className="lbt-title">Sage is using your product</span>
        {host && <span className="lbt-host">{host}</span>}
        {/* Count REAL captures only — narration ticks (probing, doc hunt, design phases) are work
            notes, not states, and inflating the number is fabricated progress. */}
        <span className="lbt-count">
          <b>{withShots.length}</b> state{withShots.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="lbt-screen">
        {frame?.screenshot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={frame.screenshot}
            className="lbt-frame"
            src={frame.screenshot}
            alt={latest.label}
          />
        ) : (
          <div className="lbt-frame lbt-frame-none" />
        )}
        <div className="lbt-caption">
          <span className="lbt-step-n">{latest.n + 1}</span>
          {latest.label}
        </div>
      </div>

      {/* THE ACTION LOG — what Sage DID, as an agent's own log: verb, consequence, timestamp.
          Newest first so "now" is always the top line; every line is a real recorded step. */}
      <div className="lbt-log">
        {steps
          .slice(-7)
          .reverse()
          .map((s, idx) => {
            const kind = stepKind(s.label);
            const Icon = KIND_ICON[kind];
            return (
              <div key={s.n} className={`lbt-log-line${idx === 0 ? " now" : ""}`} data-kind={kind}>
                <Icon className="lbt-log-icon" aria-hidden />
                <span className="lbt-log-label">{s.label}</span>
                <span className="lbt-log-t">{offset(s, steps[0]!)}</span>
              </div>
            );
          })}
      </div>

      {strip.length > 1 && (
        <div className="lbt-strip">
          {strip.map((s) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={s.n}
              className={`lbt-thumb${s.n === latest.n ? " now" : ""}`}
              src={s.screenshot!}
              alt={s.label}
              title={s.label}
            />
          ))}
        </div>
      )}
    </div>
  );
}
