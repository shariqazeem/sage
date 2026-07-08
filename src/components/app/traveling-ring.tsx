"use client";

import { useEffect, useRef, type RefObject } from "react";
import { usd } from "@/lib/format";

/**
 * The persistent traveling ring — a single canvas that never unmounts and glides
 * (FLIP) between each screen's `[data-slot]`, resizing to fit. It is the signature
 * of the whole experience: the object you fund becomes the object you seal becomes
 * the heart of your app. Positioning + drawing run in one rAF loop that reads the
 * active slot's live rect, so it follows layout and animates via a CSS transition.
 */
export interface RingState {
  mode: "ready" | "forming" | "sealing" | "sealed" | "live";
  budget: number;
  /** 0–1 while funding (forming). */
  fundFrac: number;
  /** 0–1 while press-and-hold sealing. */
  holdProg: number;
  /** live remaining (mode "live"). */
  remaining: number;
  /** ms epoch until which the red refusal flash plays. */
  flashUntil?: number;
}

const S = 300;
const INK = "#1a1d21";
const TRACK = "#ecebe6";
const GREEN = "#15803d";
const INDIGO = "#4f46e5";

export function TravelingRing({
  slotKey,
  ringRef,
  rootRef,
}: {
  slotKey: string | null;
  /** mutated in place by the parent (fund/seal run at 60fps without re-renders). */
  ringRef: RefObject<RingState>;
  rootRef: RefObject<HTMLElement | null>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bigRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef(slotKey);
  slotRef.current = slotKey;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = S * dpr;
    canvas.height = S * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastTransform = "";
    let lastBig = "";
    let lastSub = "";

    const frame = () => {
      const root = rootRef.current;
      const key = slotRef.current;
      const slot =
        key && root
          ? (root.querySelector(`[data-slot="${key}"]`) as HTMLElement | null)
          : null;

      if (slot && root) {
        const rr = root.getBoundingClientRect();
        const sr = slot.getBoundingClientRect();
        const cx = sr.left - rr.left + sr.width / 2;
        const cy = sr.top - rr.top + sr.height / 2;
        const k = sr.width / S;
        const t = `translate(${cx - (S / 2) * k}px, ${cy - (S / 2) * k}px) scale(${k})`;
        if (t !== lastTransform) {
          wrap.style.transform = t;
          lastTransform = t;
        }
        if (wrap.style.opacity !== "1") wrap.style.opacity = "1";
      } else if (wrap.style.opacity !== "0") {
        wrap.style.opacity = "0";
      }

      draw(ctx, dpr, ringRef.current);

      // overlay text
      const [big, sub, color, mono] = label(ringRef.current);
      if (bigRef.current && big !== lastBig) {
        bigRef.current.textContent = big;
        lastBig = big;
      }
      if (subRef.current && sub !== lastSub) {
        subRef.current.textContent = sub;
        lastSub = sub;
      }
      if (bigRef.current) {
        bigRef.current.style.color = color;
        bigRef.current.style.fontFamily = mono
          ? "var(--font-mono), monospace"
          : "var(--font-sans), sans-serif";
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [rootRef, ringRef]);

  return (
    <div ref={wrapRef} className="sage-travelring" aria-hidden>
      <canvas ref={canvasRef} style={{ width: S, height: S, display: "block" }} />
      <div className="sage-travelring-mid">
        <div ref={bigRef} className="v mono" />
        <div ref={subRef} className="k mono" />
      </div>
    </div>
  );
}

function draw(ctx: CanvasRenderingContext2D, dpr: number, R: RingState) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, S, S);
  const lw = 15;
  const r = S / 2 - lw / 2 - 12;
  const c = S / 2;
  const TOP = -Math.PI / 2;
  ctx.lineCap = "round";

  // track
  ctx.lineWidth = lw;
  ctx.strokeStyle = TRACK;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.stroke();

  // main arc
  let frac = 1;
  let col = INK;
  if (R.mode === "forming") {
    frac = R.fundFrac;
    col = GREEN;
  } else if (R.mode === "live") {
    frac = R.budget > 0 ? Math.max(0, R.remaining / R.budget) : 0;
  }
  if (frac > 0.001) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.arc(c, c, r, TOP, TOP + frac * Math.PI * 2, false);
    ctx.stroke();
  }

  // sealing seal (indigo grows with holdProg)
  if (R.mode === "sealing" || R.mode === "sealed") {
    const p = R.mode === "sealed" ? 1 : R.holdProg || 0;
    if (p > 0.001) {
      ctx.lineWidth = lw * 0.46;
      ctx.strokeStyle = INDIGO;
      ctx.beginPath();
      ctx.arc(c, c, r, TOP, TOP + p * Math.PI * 2, false);
      ctx.stroke();
    }
    const crad = 20 + 10 * p;
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(79,70,229,${0.25 + 0.55 * p})`;
    ctx.beginPath();
    ctx.arc(c, c, crad, 0, Math.PI * 2);
    ctx.stroke();
    if (p >= 0.999) {
      ctx.fillStyle = INDIGO;
      ctx.beginPath();
      ctx.arc(c, c, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // refusal flash (red) — a vault door refusing, not an alarm
  if (R.flashUntil && Date.now() < R.flashUntil) {
    const pulse = 0.45 + 0.55 * Math.abs(Math.sin(Date.now() / 110));
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(220,38,38,${0.55 * pulse})`;
    ctx.beginPath();
    ctx.arc(c, c, r + lw / 2 + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = lw * 0.5;
    ctx.strokeStyle = `rgba(220,38,38,${0.35 + 0.35 * pulse})`;
    ctx.beginPath();
    ctx.arc(c, c, r, TOP + frac * Math.PI * 2, TOP + (frac + 0.13) * Math.PI * 2, false);
    ctx.stroke();
  }
}

/** [big, sub, color, mono] overlay text for the ring. */
function label(R: RingState): [string, string, string, boolean] {
  if (R.mode === "forming")
    return [usd(Math.round(R.fundFrac * R.budget)), `of ${usd(R.budget)} funding`, INK, true];
  if (R.mode === "sealing") {
    const p = R.holdProg || 0;
    if (p < 0.02) return [usd(R.budget), "budget ceiling", INK, true];
    return [`${Math.round(p * 100)}%`, "sealing…", INDIGO, true];
  }
  if (R.mode === "sealed") return ["Sealed", "keys handed over", INDIGO, false];
  if (R.mode === "live")
    return [usd(R.remaining), `of ${usd(R.budget)} limit`, INK, true];
  return [usd(R.budget), "budget ceiling", INK, true];
}
