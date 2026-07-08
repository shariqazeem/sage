"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A press-and-hold confirm button — the conic fill ring lives in motion.css
 * (.sage-onb-hold, driven by the JS-set `--hold` var, rubber-bands on early
 * release). Weighty by design: used for deliberate, consequential actions
 * (revoke a vault, enable autopilot). Respects reduced-motion via the global rule.
 */
export function HoldButton({
  label,
  onComplete,
  durationMs = 1200,
  className = "",
}: {
  label: ReactNode;
  onComplete: () => void;
  durationMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const raf = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const doneRef = useRef(false);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  function start() {
    doneRef.current = false;
    if (timer.current) window.clearTimeout(timer.current);
    ref.current?.classList.remove("releasing");
    const t0 = performance.now();
    const tick = (n: number) => {
      const p = Math.min(1, (n - t0) / durationMs);
      ref.current?.style.setProperty("--hold", String(p));
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else {
        doneRef.current = true;
        onComplete();
      }
    };
    raf.current = requestAnimationFrame(tick);
  }

  function end() {
    cancelAnimationFrame(raf.current);
    if (doneRef.current) return;
    const btn = ref.current;
    if (!btn) return;
    btn.classList.add("releasing");
    btn.style.setProperty("--hold", "0");
    timer.current = window.setTimeout(() => btn.classList.remove("releasing"), 460);
  }

  return (
    <button
      ref={ref}
      className={`sage-onb-hold ${className}`}
      onPointerDown={start}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerCancel={end}
    >
      {label}
    </button>
  );
}
