"use client";

import { useEffect, useRef } from "react";
import { usd } from "@/lib/format";

/**
 * The Budget Ring — the signature element. A canvas arc showing remaining-of-
 * budget, driven by LIVE vault state. When `remaining` changes it animates the
 * drain (ink arc recedes, the figure rolls) and pulses green at the drained edge;
 * pass `phase="block"` to flash the red "vault door refusing" cue without draining.
 *
 * Canvas (not SVG) so the arc, the count, and the settle/block cues share one
 * paint and stay crisp at any DPR. Colors come straight from the design system.
 */
const INK = "#1a1d21";
const TRACK = "#ecebe6";
const RED = "#dc2626";
const MUTED = "#9a9da2";

const easeInOut = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

interface Props {
  remaining: number;
  budget: number;
  size?: number;
  /** transient cue: "block" flashes red refusal without draining. */
  phase?: "idle" | "block";
  /** revoked vault — arc goes muted. */
  danger?: boolean;
  /** sub-label under the figure; defaults to "of $<budget> limit". */
  label?: string;
}

export function BudgetRing({
  remaining,
  budget,
  size = 220,
  phase = "idle",
  danger = false,
  label,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bigRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | undefined>(undefined);
  // animated state persisted across renders
  const fracRef = useRef(budget > 0 ? clamp(remaining / budget) : 0);
  const valRef = useRef(remaining);
  const prevFracRef = useRef(fracRef.current);
  const flashUntilRef = useRef(0);
  const settleUntilRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const lw = Math.max(11, size * 0.05);
    const r = size / 2 - lw / 2 - Math.max(6, size * 0.04);
    const c = size / 2;
    const TOP = -Math.PI / 2;
    const arc = (f: number) => TOP + clamp(f) * Math.PI * 2;

    const targetFrac = budget > 0 ? clamp(remaining / budget) : 0;
    const targetVal = remaining;
    const startFrac = fracRef.current;
    const startVal = valRef.current;
    prevFracRef.current = startFrac;
    // a drain (remaining went down) earns a green edge pulse
    if (targetFrac < startFrac - 0.0005) settleUntilRef.current = performance.now() + 900;
    if (phase === "block") flashUntilRef.current = performance.now() + 950;

    const start = performance.now();
    const DUR = 820;

    const draw = () => {
      const now = performance.now();
      const p = Math.min(1, (now - start) / DUR);
      const e = easeInOut(p);
      fracRef.current = startFrac + (targetFrac - startFrac) * e;
      valRef.current = startVal + (targetVal - startVal) * e;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.lineCap = "round";

      // track
      ctx.lineWidth = lw;
      ctx.strokeStyle = TRACK;
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();

      // settle glow: green segment from current edge back to where it started
      if (now < settleUntilRef.current) {
        const k = clamp((settleUntilRef.current - now) / 900);
        ctx.lineWidth = lw;
        ctx.strokeStyle = `rgba(21,128,61,${0.8 * k})`;
        ctx.beginPath();
        ctx.arc(c, c, r, arc(fracRef.current), arc(prevFracRef.current), false);
        ctx.stroke();

        // settle ripple: an emerald ring blooming outward from the track, fading.
        // the satisfying "payout landed" pulse — one ring, not an alarm.
        const kr = clamp(1 - k); // 0 → 1 over the window
        ctx.lineWidth = Math.max(1.5, lw * 0.4 * (1 - kr));
        ctx.strokeStyle = `rgba(21,128,61,${0.42 * (1 - kr)})`;
        ctx.beginPath();
        ctx.arc(c, c, r + kr * lw * 2.4, 0, Math.PI * 2);
        ctx.stroke();
      }

      // the live ink arc
      const f = fracRef.current;
      if (f > 0.001) {
        ctx.lineWidth = lw;
        ctx.strokeStyle = danger ? MUTED : INK;
        ctx.beginPath();
        ctx.arc(c, c, r, TOP, arc(f), false);
        ctx.stroke();
      }

      // block flash: a solid red hairline outside + a short segment on the
      // boundary the arc will not cross. a vault door refusing, not an alarm.
      if (now < flashUntilRef.current) {
        const pulse = 0.45 + 0.55 * Math.abs(Math.sin(now / 110));
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(220,38,38,${0.55 * pulse})`;
        ctx.beginPath();
        ctx.arc(c, c, r + lw / 2 + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = lw * 0.5;
        ctx.strokeStyle = `rgba(220,38,38,${0.35 + 0.35 * pulse})`;
        ctx.beginPath();
        ctx.arc(c, c, r, arc(f), arc(f + 0.13), false);
        ctx.stroke();
      }

      if (bigRef.current) bigRef.current.textContent = usd(valRef.current);

      if (p < 1 || now < flashUntilRef.current || now < settleUntilRef.current) {
        rafRef.current = requestAnimationFrame(draw);
      }
    };

    cancelAnimationFrame(rafRef.current ?? 0);
    rafRef.current = requestAnimationFrame(draw);

    // pause the loop when the tab is backgrounded; resume (and settle to the
    // final frame) when it returns. No rAF ever spins on a hidden tab.
    const onVis = () => {
      cancelAnimationFrame(rafRef.current ?? 0);
      if (!document.hidden) rafRef.current = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(rafRef.current ?? 0);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [remaining, budget, size, phase, danger]);

  return (
    <div
      className="sage-ring"
      style={{ position: "relative", width: size, height: size }}
    >
      <canvas
        ref={canvasRef}
        className="sage-ring-canvas"
        style={{ display: "block" }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          pointerEvents: "none",
        }}
      >
        <div
          ref={bigRef}
          style={{
            fontFamily: "var(--font-mono), monospace",
            fontWeight: 700,
            letterSpacing: "-.03em",
            lineHeight: 1,
            color: danger ? RED : INK,
            fontSize: Math.round(size * 0.155),
          }}
        >
          {usd(remaining)}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono), monospace",
            fontWeight: 500,
            color: MUTED,
            letterSpacing: ".02em",
            fontSize: Math.round(size * 0.052),
          }}
        >
          {label ?? `of ${usd(budget)} limit`}
        </div>
      </div>
    </div>
  );
}

function clamp(x: number) {
  return Math.max(0, Math.min(1, x));
}
