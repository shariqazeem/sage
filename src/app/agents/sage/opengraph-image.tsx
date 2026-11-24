import { ImageResponse } from "next/og";
import { getAgentReputation } from "@/lib/erc8004/reputation";
import { getPrimaryAgentIdentity } from "@/lib/erc8004/identity";
import { INK, MARK, PAPER, PENCIL, SEAL } from "@/lib/brand/stop";
import { ogFonts } from "@/lib/brand/og-fonts";

// Reads the live track record on each scrape, so it runs on the Node runtime.
export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Sage — Autonomous Payout Agent";

const MUTED = PENCIL;
const XC = "Fira Sans Extra Condensed";

function Stat({ v, k }: { v: string; k: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontFamily: XC, fontSize: 72, fontWeight: 800, lineHeight: 1 }}>{v}</div>
      <div style={{ fontSize: 24, color: MUTED }}>{k}</div>
    </div>
  );
}

/** The real share card for /agents/sage — identity + the live headline stats, in The Stop. */
export default async function OG() {
  const fonts = await ogFonts();
  const k = 34 / MARK.wall.h;
  const r = getAgentReputation();
  const id = getPrimaryAgentIdentity();
  const settled = `$${(r.settledTotalBase / 1e6).toFixed(2)}`;

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
          padding: "56px 64px",
          justifyContent: "space-between",
          fontFamily: "Fira Sans",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", height: 34 }}>
              <div style={{ width: MARK.path.w * k, height: MARK.path.h * k, background: INK }} />
              <div style={{ width: MARK.wall.w * k, height: 34, background: SEAL }} />
            </div>
            <div style={{ fontFamily: XC, fontWeight: 800, fontSize: 40, letterSpacing: 2.6 }}>SAGE</div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              border: `2px solid ${id.registered ? INK : MUTED}`,
              color: id.registered ? INK : MUTED,
              padding: "10px 20px",
              fontFamily: "Fira Mono",
              fontSize: 22,
            }}
          >
            {id.registered ? `ERC-8004 · #${id.agentId}` : "ERC-8004 · pending"}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontFamily: XC, fontSize: 92, fontWeight: 800, lineHeight: 0.92 }}>Proof of work,</div>
          <div style={{ fontFamily: XC, fontSize: 92, fontWeight: 800, lineHeight: 0.92, color: SEAL }}>for people.</div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 64 }}>
            <Stat v={settled} k="USDC settled" />
            <Stat v={String(r.payoutCount)} k="payouts" />
            <Stat v={String(r.blockedCount)} k="blocked" />
            <Stat v={String(r.decisionCount)} k="decisions" />
          </div>
          <div style={{ display: "flex", fontSize: 25, color: MUTED }}>{id.network}</div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
