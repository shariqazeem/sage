/**
 * THE STOP (24 Nov 2026): Sage's flagship identity, as code. Every try stops somewhere: an ink line runs
 * as far as a person got, and Sage's hand, in seal red, marks the stop. These are pure functions that
 * return geometry and numbers, safe on the server and in the browser. They never use randomness: the
 * same record always draws the same picture, so anyone can redraw it.
 *
 * The design source is ~/projects/sage-launch/design/FLAGSHIP.md (kept out of this public repo).
 */

export const INK = "#161b29";
export const SEAL = "#ba0c2f";
export const PAPER = "#ffffff";
export const PENCIL = "#75787b";
export const COPY = "#efefed";
export const RULE = "#d7d7d4";

/**
 * The mark ⊣ on a 200 grid. The path comes in from its container's left edge and stops at the wall:
 * path 34 tall at y 83–117, from x 0 to 118; wall 38 × 150 at x 118–156, y 25–175.
 */
export const MARK = {
  grid: 200,
  path: { x: 0, y: 83, w: 118, h: 34 },
  wall: { x: 118, y: 25, w: 38, h: 150 },
} as const;

/** FNV-1a, 32-bit: a tiny deterministic hash (the same in the design kit and here). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The paid stamp's angle, from the payout's own transaction (or any stable seed): unique per payout and
 * repeatable, so no two land alike and a revisit draws the same stamp. Rounded to 0.01°.
 */
export function stampAngle(seed: string, lo = -9, hi = 9): number {
  const u = hash32(seed) / 0xffffffff;
  return Math.round((lo + (hi - lo) * u) * 100) / 100;
}
