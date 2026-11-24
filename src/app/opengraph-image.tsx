import { ImageResponse } from "next/og";
import { INK, MARK, PAPER, PENCIL, SEAL } from "@/lib/brand/stop";
import { ogFonts } from "@/lib/brand/og-fonts";
import { stuckAtTheWall } from "@/lib/brand/worker";

// The DEFAULT share card (The Stop, 24 Nov 2026): every surface without its own card gets this one.
// Satori can't read CSS variables, so the brand's literal values come from src/lib/brand/stop.ts.
export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Sage: real people try what you built, each paid in USDC on Metis only for a try Sage checked. Every try stops somewhere.";

const XC = "Fira Sans Extra Condensed";

/** the mark ⊣ drawn with boxes (Satori draws divs exactly) */
function Mark({ h }: { h: number }) {
  const k = h / MARK.wall.h;
  return (
    <div style={{ display: "flex", alignItems: "center", height: h, width: (MARK.wall.x + MARK.wall.w) * k }}>
      <div style={{ width: MARK.path.w * k, height: MARK.path.h * k, background: INK }} />
      <div style={{ width: MARK.wall.w * k, height: h, background: SEAL }} />
    </div>
  );
}

export default async function OG() {
  const fonts = await ogFonts();
  const scene = `data:image/svg+xml;utf8,${encodeURIComponent(stuckAtTheWall(1200, 630, { bandY: 470, band: 92, wallX: 1046, wallW: 60, steps: 4, scale: 1.45 }))}`;
  return new ImageResponse(
    (
      <div style={{ display: "flex", position: "relative", width: "100%", height: "100%", background: PAPER, color: INK, fontFamily: "Fira Sans" }}>
        <img src={scene} width={1200} height={630} alt="" style={{ position: "absolute", left: 0, top: 0 }} />
        <div style={{ position: "absolute", left: 64, top: 56, display: "flex", alignItems: "center", gap: 14 }}>
          <Mark h={34} />
          <div style={{ fontFamily: XC, fontWeight: 800, fontSize: 40, letterSpacing: 2.6 }}>SAGE</div>
        </div>
        <div style={{ position: "absolute", left: 64, top: 128, display: "flex", flexDirection: "column", fontFamily: XC, fontWeight: 800, fontSize: 104, lineHeight: 0.9 }}>
          <div style={{ display: "flex" }}>Every try</div>
          <div style={{ display: "flex" }}>stops somewhere.</div>
        </div>
        <div style={{ position: "absolute", left: 64, top: 360, width: 760, display: "flex", fontSize: 26, lineHeight: 1.35, color: INK }}>
          Real people try what you built. Each is paid in USDC on Metis, only for a try Sage checked.
        </div>
        <div style={{ position: "absolute", left: 64, bottom: 28, display: "flex", fontFamily: "Fira Mono", fontSize: 20, letterSpacing: 1.5, color: PENCIL }}>
          SAGEPAYS.XYZ
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
