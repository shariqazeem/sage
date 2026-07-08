"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "./use-in-view";

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * A number that counts up from 0 to its real value the first time it scrolls
 * into view. JetBrains Mono + tabular figures so digits don't reflow. Under
 * prefers-reduced-motion it snaps straight to the final value (via useInView,
 * which reports inView immediately) — fully readable, no animation.
 */
export function CountUpLanding({
  value,
  format,
  duration = 1400,
  className = "",
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>({ threshold: 0.4 });
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!inView) return;
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(value * easeOutExpo(t));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [inView, value, duration]);

  return (
    <span
      ref={ref}
      className={`clx-mono ${className}`}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {format ? format(display) : Math.round(display).toLocaleString("en-US")}
    </span>
  );
}
