import { MARK } from "@/lib/brand/stop";

/**
 * THE ONE SAGE MARK: ⊣ (The Stop, 24 Nov 2026).
 *
 * An ink path comes in from the left and stops at a red wall: how far a person got, and Sage marking
 * where it stopped. Two rectangles, drawn inline, so it is crisp at every size and costs no request.
 * Every surface that already used <SageMark/> (the top bar, the proof page, the agent pages) picks it up
 * with no per-surface change. The colours come from the tokens: ink for the path, seal for the wall.
 *
 * `glyph` (the default) draws the mark tight to its ink, for running heads and lockups; `framed` draws it
 * on the full 200 grid, as the avatar and the app icon do, where the path bleeds in from the edge.
 */
export function SageMark({
  size = 22,
  className = "",
  framed = false,
  title,
}: {
  size?: number;
  className?: string;
  framed?: boolean;
  title?: string;
}) {
  const { path, wall } = MARK;
  const viewBox = framed ? `0 0 ${MARK.grid} ${MARK.grid}` : `0 ${wall.y} ${wall.x + wall.w} ${wall.h}`;
  const width = framed ? size : Math.round((size * (wall.x + wall.w)) / wall.h);
  return (
    <svg
      className={`sage-mark ${className}`.trim()}
      viewBox={viewBox}
      width={width}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <rect x={path.x} y={path.y} width={path.w} height={path.h} className="sage-mark-path" />
      <rect x={wall.x} y={wall.y} width={wall.w} height={wall.h} className="sage-mark-wall" />
    </svg>
  );
}
