/**
 * A READING MEANS NOTHING WITHOUT ITS ALTERNATIVE.
 *
 * Each outcome here was a big number followed by four lines of prose doing the comparison in words —
 * "against the corridor this track names (7–9% average fees)…". The comparison IS the claim, so it
 * should be seen before it is read: two bars, ours and theirs, to one scale.
 *
 * Plain markup on the design system's own tokens — no chart library, no client cost, and it cannot
 * drift from the palette.
 */
export function CompareBar({
  ours,
  theirs,
  oursLabel,
  theirsLabel,
  alternativeName = "Alternative",
  caption,
  lowerIsBetter = false,
}: {
  ours: number;
  theirs: number;
  oursLabel: string;
  theirsLabel: string;
  alternativeName?: string;
  caption?: string;
  lowerIsBetter?: boolean;
}) {
  const max = Math.max(ours, theirs, 0.0001);
  // Zero is the strongest reading on this page ("we take nothing"), and a 2% stub reads as a
  // rendering artefact rather than as none. Draw nothing, and let the label carry it.
  const pct = (v: number) => (v <= 0 ? 0 : Math.max(6, (v / max) * 100));
  return (
    <div className="cmp" role="img" aria-label={`Sage ${oursLabel} versus ${alternativeName} ${theirsLabel}`}>
      <div className="cmp-row">
        <span className="cmp-k">Sage</span>
        <span className="cmp-track">{pct(ours) > 0 && <span className={`cmp-fill ${lowerIsBetter ? "good" : "ours"}`} style={{ width: `${pct(ours)}%` }} />}</span>
        <span className="cmp-v mono">{oursLabel}</span>
      </div>
      <div className="cmp-row">
        <span className="cmp-k">{alternativeName}</span>
        <span className="cmp-track"><span className="cmp-fill theirs" style={{ width: `${pct(theirs)}%` }} /></span>
        <span className="cmp-v mono muted">{theirsLabel}</span>
      </div>
      {caption && <p className="cmp-cap">{caption}</p>}
    </div>
  );
}
