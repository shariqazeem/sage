import Link from "next/link";

/**
 * THE WAIT, DRAWN — every settled payout placed on a time axis by how long its own worker waited.
 *
 * The board used to make its strongest claim in a sentence ("Sage checks it and pays in USDC"), which
 * is the same sentence any product could write. The measured wait is the one thing here that cannot
 * be typed: each dot below IS a settled payout, positioned by that person's own submit-to-chain
 * time, and it opens the receipt. The median is stated once, in numbers, because a distribution
 * needs an anchor — but the picture, not the number, is what says "fast".
 *
 * The axis is logarithmic on purpose. On a linear axis a spread of 90 seconds to an hour collapses
 * every fast payout into a single blot against the left edge, which would hide precisely the thing
 * being shown. Log keeps minutes legible next to hours; the labelled gridlines say what the spacing
 * means so it cannot read as a linear one.
 */

const MIN_S = 30; // half a minute — the left edge; a faster payout pins here rather than falling off.
/** Half a dot's width, so a mark at either extreme sits ON the rail instead of half outside it. */
const INSET_PX = 7;
const AXIS = [
  { s: 60, label: "1m" },
  { s: 600, label: "10m" },
  { s: 3600, label: "1h" },
  { s: 86_400, label: "1d" },
];

/**
 * The axis top, with headroom past the slowest payout so the last dot is never welded to the edge
 * (and so an all-fast board still shows the hour mark it beat).
 */
export function axisMax(samples: number[]): number {
  return Math.max(3600, ...samples.map((s) => s * 1.35));
}

/** Where a duration sits, 0..1, on a log axis running from MIN_S to `max`. */
export function place(seconds: number, max: number): number {
  const lo = Math.log(MIN_S);
  const hi = Math.log(Math.max(max, MIN_S * 2));
  const v = Math.log(Math.max(seconds, MIN_S));
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

/** "2m 24s" / "1h 05m" / "18s" — short enough to be a headline, exact enough to be a measurement. */
export function humanWait(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s === 0 ? `${m}m` : `${m}m ${String(s).padStart(2, "0")}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, "0")}m`;
}

export function WaitStrip({
  medianSeconds,
  measured,
  dots,
}: {
  medianSeconds: number;
  measured: number;
  /** one entry per measured payout — the dot and the receipt it opens. */
  dots: { txHash: string; seconds: number; usd: number }[];
}) {
  const max = axisMax(dots.map((d) => d.seconds));
  const ticks = AXIS.filter((t) => t.s <= max);
  /* Percentages alone clip a mark at either end by half its width; the rail is inset by that much. */
  const at = (seconds: number) => `calc(${INSET_PX}px + ${place(seconds, max).toFixed(4)} * (100% - ${INSET_PX * 2}px))`;
  const only = measured === 1;

  return (
    <section className="mk-side-card mk-wait">
      <h2 className="mk-side-h">Submit &rarr; paid</h2>
      <div className="mk-wait-v mono">{humanWait(medianSeconds)}</div>
      {/* A median over one sample is not a median, it is that sample — so it does not claim to be. */}
      <div className="mk-wait-k">
        {only ? "the one payout measured so far" : `median wait, measured over ${measured} payouts`}
      </div>

      <div className="mk-wait-axis" aria-hidden>
        {ticks.map((t) => (
          <span key={t.s} className="mk-wait-grid" style={{ left: at(t.s) }}>
            <i />
            <b className="mono">{t.label}</b>
          </span>
        ))}
        {!only && <span className="mk-wait-med" style={{ left: at(medianSeconds) }} />}
        {dots.map((d) => (
          <Link
            key={d.txHash}
            href={`/proof/${d.txHash}`}
            className="mk-wait-dot"
            style={{ left: at(d.seconds) }}
            title={`$${d.usd.toFixed(2)} paid ${humanWait(d.seconds)} after it was submitted`}
          />
        ))}
      </div>

      <p className="mk-side-foot">Each dot is one payout. Open it and check the transaction.</p>
    </section>
  );
}
