import { MARK, stampAngle } from "@/lib/brand/stop";

/**
 * THE PAID STAMP: Sage's signature moment (The Stop, 24 Nov 2026). A round seal stamp in Sage's red,
 * the colour of Sage's hand, used for what Sage marked and nothing else.
 *
 * It lands once per payout, when the real settlement arrives: pass `land` on the render where a
 * ticket's state BECOMES paid (it falls and lands dead, no bounce). A ticket that was already paid when
 * the page loaded is simply stamped, with no motion, so nothing is ever replayed for effect.
 *
 * Its angle comes from `seed` (the payout's transaction or receipt address), so no two land alike and a
 * revisit draws the same stamp. It is never drawn smaller than 40 px: below that a ring with a bar reads
 * as "no entry", so small lists use the word alone.
 */
export function PaidStamp({ land = false, label = "Paid", seed = "", size = 64 }: { land?: boolean; label?: string; seed?: string; size?: number }) {
  const angle = stampAngle(seed || label);
  const px = Math.max(40, size);
  const { path, wall } = MARK;
  return (
    <span className="sg-stamp" data-land={land || undefined} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" width={px} height={px} aria-hidden="true" focusable="false">
        <g fill="currentColor" transform={`rotate(${angle} 50 50)`}>
          <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="4.5" />
          <circle cx="50" cy="50" r="39.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <g transform="translate(40 20) scale(0.13)">
            <rect x={path.x} y={path.y} width={path.w} height={path.h} />
            <rect x={wall.x} y={wall.y} width={wall.w} height={wall.h} />
          </g>
          <text x="50" y="60" textAnchor="middle" fontSize="23" letterSpacing="2">
            {label.toUpperCase()}
          </text>
          <rect x="30" y="66" width="40" height="2.8" />
          <rect x="30" y="71" width="40" height="2.8" />
        </g>
      </svg>
    </span>
  );
}
