"use client";

import { useEffect, useRef, useState } from "react";

interface TrailStep {
  n: number;
  label: string;
  screenshot: string | null;
  url: string;
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
  // the recent tail, oldest → newest, so the strip reads left to right and ends on "now".
  const strip = withShots.slice(-9);
  let host = "";
  try {
    host = new URL(latest.url).host;
  } catch {
    host = "";
  }

  return (
    <div className="lbt">
      <div className="lbt-head">
        <span className="lbt-live" />
        <span className="lbt-title">Sage is using your product</span>
        {host && <span className="lbt-host">{host}</span>}
        <span className="lbt-count">
          <b>{steps.length}</b> state{steps.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="lbt-screen">
        {latest.screenshot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={latest.screenshot}
            className="lbt-frame"
            src={latest.screenshot}
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
