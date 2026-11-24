import { INK, PAPER, SEAL } from "./stop";

/**
 * Sage, drawn: a working rubber stamp with no face and no hands (The Stop's character). It is only ever
 * drawn doing something (one of its twelve verbs), never posing; it never speaks, never celebrates and never
 * holds money; its only red is its sole and the prints it leaves. On a receipt, the ledger or the findings
 * only its print appears, never the worker. Never the avatar.
 *
 * Pure SVG strings (for share images and static art). Origin = the bottom centre of its sole; the sole is 100
 * wide at scale 1.
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface WorkerPose {
  x?: number;
  y?: number;
  s?: number;
  /** degrees, about `pivot`; + leans right */
  rot?: number;
  pivot?: "c" | "l" | "r";
  /** head offset, + right */
  bend?: number;
  stretch?: number;
  squash?: number;
  /** the paper tag on its front: the step it is on */
  label?: string;
}

export function workerSvg(o: WorkerPose = {}): string {
  const { x = 0, y = 0, s = 1, rot = 0, pivot = "c", bend = 0, stretch = 1, squash = 0, label = "" } = o;
  const hw = 50,
    mw = hw - 4,
    L = 24 * stretch,
    hx = bend,
    hy = -58 - L - 15;
  const px = pivot === "l" ? -hw : pivot === "r" ? hw : 0;
  const sy = 1 - squash,
    sx = 1 + squash * 0.5;
  let g = `<g transform="translate(${r2(x)} ${r2(y)}) scale(${r2(s)}) rotate(${r2(rot)} ${px} 0) scale(${r2(sx)} ${r2(sy)})">`;
  g += `<rect x="${-hw}" y="-9" width="${hw * 2}" height="9" rx="2" fill="${SEAL}"/>`;
  g += `<path d="M${-mw} -11 V-35 Q${-mw} -44 ${-mw + 9} -44 H${mw - 9} Q${mw} -44 ${mw} -35 V-11 Z" fill="${INK}"/>`;
  g += `<rect x="-17" y="-35" width="34" height="15" rx="1" fill="${PAPER}"/>`;
  if (label) g += `<text x="0" y="-23.4" text-anchor="middle" font-family="monospace" font-weight="700" font-size="11.5" fill="${INK}">${label}</text>`;
  g += `<path d="M-23 -43.5 C-12 -46 -8 -52 -7 -60 H7 C8 -52 12 -46 23 -43.5 Z" fill="${INK}"/>`;
  g += `<path d="M0 -58 Q0 ${r2(-58 - L * 0.7)} ${r2(hx)} ${r2(hy + 6)}" stroke="${INK}" stroke-width="14" stroke-linecap="round" fill="none"/>`;
  const tilt = ((Math.atan2(hx, L + 20) * 180) / Math.PI) * 0.9;
  g += `<ellipse cx="${r2(hx)}" cy="${r2(hy)}" rx="25.5" ry="22.5" fill="${INK}" transform="rotate(${r2(tilt)} ${r2(hx)} ${r2(hy)})"/>`;
  return g + "</g>";
}

/** A print seen edge-on: one step on the ground line, in Sage's red. */
export function printSvg(x: number, y: number, w = 50, h = 7): string {
  return `<rect x="${r2(x - w / 2)}" y="${r2(y - h)}" width="${w}" height="${h}" fill="${SEAL}"/>`;
}

/**
 * The scene the brand opens on: Sage went first and is stuck at the wall, printing the same step again.
 * `w` × `h` is the drawing's box; the ink band runs from the left edge to `wallX`, the red wall is full height.
 */
export function stuckAtTheWall(w: number, h: number, opts: { bandY: number; band: number; wallX: number; wallW: number; steps?: number; scale?: number }): string {
  const { bandY, band, wallX, wallW, steps = 4, scale = 1.4 } = opts;
  const gap = (wallX - 140) / (steps + 0.6);
  let g = `<rect x="0" y="${bandY}" width="${wallX}" height="${band}" fill="${INK}"/><rect x="${wallX}" y="0" width="${wallW}" height="${h}" fill="${SEAL}"/>`;
  for (let i = 0; i < steps; i++) {
    const cx = 70 + i * gap;
    g += printSvg(cx, bandY, 60, 9);
    g += `<text x="${r2(cx)}" y="${bandY + 40}" text-anchor="middle" font-family="monospace" font-size="16" fill="${PAPER}">${String(i + 1).padStart(2, "0")}</text>`;
  }
  const px = wallX - 64;
  for (const [dy, r] of [
    [0, -3],
    [-10, 4],
    [-20, -5],
  ]) {
    g += `<g transform="rotate(${r} ${px} ${bandY + dy})">${printSvg(px, bandY + dy, 70, 9)}</g>`;
  }
  const n = String(steps + 1).padStart(2, "0");
  g += `<text x="${px}" y="${bandY + 40}" text-anchor="middle" font-family="monospace" font-size="16" fill="${PAPER}">${n} ${n} ${n}</text>`;
  g += workerSvg({ x: px + 14, y: bandY - 30, s: scale, rot: 12, pivot: "r", bend: -14, label: n });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${g}</svg>`;
}
