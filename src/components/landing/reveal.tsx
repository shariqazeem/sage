"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * A tiny scroll-into-view island. It only TOGGLES `is-in` on its wrapper — the visual
 * treatment is the caller's CSS (`.reveal` fades up; `.stage` just plays its inner
 * timeline). Children are server-rendered and passed through untouched, so wrapping a
 * scene in <Reveal> keeps it a Server Component. Under reduced-motion (or before JS) it
 * resolves to `is-in` immediately, so nothing is ever hidden.
 */
export function Reveal({
  children,
  className = "",
  style,
  threshold = 0.12,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  threshold?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            io.disconnect();
          }
        }
      },
      { threshold, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  return (
    <div ref={ref} className={`${className}${inView ? " is-in" : ""}`} style={style}>
      {children}
    </div>
  );
}
