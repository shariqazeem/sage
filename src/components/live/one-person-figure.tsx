/**
 * THE WHOLE IDEA, DRAWN.
 *
 * This page used to explain in four lines of prose that a wallet is free to create, that one
 * operator took ten of ten slots with twelve of them, and that a proof collapses them into one
 * worker. A reader has to assemble that; a picture states it. Server-rendered SVG — no library, no
 * client cost, and it inherits the theme's own tokens so it is never a foreign object on the page.
 *
 * The twelve are not decoration: that is the real cluster from the first open Starknet gig, drawn
 * from the same links the wallet graph publishes.
 */
export function OnePersonFigure() {
  const wallets = Array.from({ length: 12 });
  const rowY = 34;
  const spread = 300;
  const startX = 24;
  const step = spread / (wallets.length - 1);
  const hubX = startX + spread / 2;
  const hubY = 128;
  return (
    <figure className="opf">
      <svg viewBox="0 0 348 168" role="img" aria-label="Twelve wallets collapsing into one verified person">
        {wallets.map((_, i) => {
          const x = startX + i * step;
          return <line key={`l${i}`} className="opf-line" x1={x} y1={rowY} x2={hubX} y2={hubY - 14} />;
        })}
        {wallets.map((_, i) => {
          const x = startX + i * step;
          return <circle key={`c${i}`} className="opf-wallet" cx={x} cy={rowY} r={6} />;
        })}
        <circle className="opf-hub-glow" cx={hubX} cy={hubY} r={22} />
        <circle className="opf-hub" cx={hubX} cy={hubY} r={13} />
        <text className="opf-cap" x={startX} y={12}>12 wallets</text>
        <text className="opf-cap opf-cap-hub" x={hubX} y={hubY + 36} textAnchor="middle">1 person</text>
      </svg>
      <figcaption>Twelve wallets took the first open gig. The chain said they were one operator — a proof says it before the money moves.</figcaption>
    </figure>
  );
}
