/**
 * The one Sage mark. A receipt glyph — the product's whole thesis is the verifiable
 * `/proof/<tx>` receipt, and the design system is "receipt minimalism." Terracotta body,
 * punched-out text rows, a torn/perforated bottom edge. Colors come from the shared tokens
 * (src/styles/tokens.css) so it tracks the palette everywhere.
 *
 * Use <SageMark/> for the glyph alone, or the mark beside the "Sage" wordmark inline. This
 * replaces the ~5 divergent per-surface marks (sb-mark "S" tiles, lx-mark, clx-mark rings).
 */
export function SageMark({
  size = 22,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* receipt body: rounded top, torn sawtooth bottom */}
      <path
        d="M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v13.6L17.25 20 15.5 18.6 13.75 20 12 18.6 10.25 20 8.5 18.6 6.75 20 5 18.6Z"
        fill="var(--accent)"
      />
      {/* punched-out text rows */}
      <rect x="8" y="8" width="8" height="1.7" rx="0.85" fill="var(--surface)" />
      <rect x="8" y="11.3" width="5" height="1.7" rx="0.85" fill="var(--surface)" />
    </svg>
  );
}
