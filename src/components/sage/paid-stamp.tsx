/**
 * THE PAID STAMP: Sage's signature moment. Green, the money colour, and used for nothing else.
 *
 * It lands once per payout, when the real settlement arrives: pass `land` on the render where a
 * ticket's state BECOMES paid (280 ms, a small overshoot). A ticket that was already paid when the
 * page loaded is simply stamped, with no motion, so nothing is ever replayed for effect.
 */
export function PaidStamp({ land = false, label = "Paid" }: { land?: boolean; label?: string }) {
  return (
    <span className="sg-stamp" data-land={land || undefined}>
      {label}
    </span>
  );
}
