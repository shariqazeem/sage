import { ImageResponse } from "next/og";

// The DEFAULT share card — every surface without its own OG (landing, board, console, dashboard) gets
// this. Receipt-minimalism, using the LITERAL token values (Satori can't read CSS vars), so the OG
// palette matches tokens.css instead of drifting.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Sage — hire an AI worker, give it a budget, not your keys";

const PAPER = "#fbfbf9";
const INK = "#1a1d21";
const ACCENT = "#c2410c";
const MUTED = "#565c64";
const BORDER = "#e9e6df";

export default function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: PAPER,
          color: INK,
          padding: "72px 84px",
          justifyContent: "space-between",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>
          <svg width="58" height="58" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v13.6L17.25 20 15.5 18.6 13.75 20 12 18.6 10.25 20 8.5 18.6 6.75 20 5 18.6Z"
              fill={ACCENT}
            />
            <rect x="8" y="8" width="8" height="1.7" rx="0.85" fill={PAPER} />
            <rect x="8" y="11.3" width="5" height="1.7" rx="0.85" fill={PAPER} />
          </svg>
          Sage
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 70, fontWeight: 800, letterSpacing: -2.5, lineHeight: 1.05 }}>Hire an AI worker.</div>
          <div style={{ fontSize: 70, fontWeight: 800, letterSpacing: -2.5, lineHeight: 1.05, color: ACCENT }}>
            Give it a budget, not your keys.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 26,
            color: MUTED,
            borderTop: `2px solid ${BORDER}`,
            paddingTop: 28,
          }}
        >
          <div style={{ display: "flex" }}>Autonomous USDC payouts for verified work — every one a receipt.</div>
          <div style={{ display: "flex" }}>sagepays.xyz</div>
        </div>
      </div>
    ),
    size,
  );
}
