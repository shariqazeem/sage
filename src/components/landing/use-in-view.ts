"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The landing's one scroll primitive: an IntersectionObserver wrapper. Every act
 * choreographs off `inView` — no scroll libraries, no scroll math. Under
 * prefers-reduced-motion (or without IO support) it reports `inView` immediately
 * so the page renders in its final, fully-readable state.
 *
 * `once` (default true) latches on first entry and disconnects — cheap, and the
 * intended behavior for entrance animations. Pass `once: false` to track
 * enter/leave (used by the Act-2 collapse sentinel).
 */
export function useInView<T extends Element>(opts?: {
  rootMargin?: string;
  threshold?: number;
  once?: boolean;
}) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  const once = opts?.once ?? true;
  const rootMargin = opts?.rootMargin ?? "0px 0px -12% 0px";
  const threshold = opts?.threshold ?? 0.15;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            if (once) io.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { rootMargin, threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once, rootMargin, threshold]);

  return { ref, inView };
}
