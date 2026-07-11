import { ImageResponse } from "next/og";
import { getAgentReputation } from "@/lib/erc8004/reputation";
import { getAgentIdentity } from "@/lib/erc8004/identity";

// Reads the live track record on each scrape, so it runs on the Node runtime.
export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Sage — Autonomous Payout Deputy";

const INK = "#0A0E14";
const PAPER = "#F8F9FA";
const MUTED = "#9BA1A6";
const POS = "#10B981";

function Stat({ v, k }: { v: string; k: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 66, fontWeight: 800, letterSpacing: -2, lineHeight: 1 }}>{v}</div>
      <div style={{ fontSize: 24, color: MUTED }}>{k}</div>
    </div>
  );
}

/** The real share card for /agents/sage — identity + the live headline stats. */
export default function OG() {
  const r = getAgentReputation();
  const id = getAgentIdentity();
  const settled = `$${(r.settledTotalBase / 1e6).toFixed(2)}`;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: INK,
          color: PAPER,
          padding: "70px 80px",
          justifyContent: "space-between",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 38, fontWeight: 700 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 10,
                background: PAPER,
                color: INK,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 32,
                fontWeight: 800,
              }}
            >
              S
            </div>
            Sage
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              border: `2px solid ${id.registered ? POS : MUTED}`,
              color: id.registered ? POS : MUTED,
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            <div style={{ width: 13, height: 13, borderRadius: 13, background: id.registered ? POS : MUTED }} />
            {id.registered ? `ERC-8004 · #${id.agentId}` : "ERC-8004 · pending"}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 60, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05 }}>
            Give an AI agent an allowance,
          </div>
          <div style={{ fontSize: 60, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05, color: MUTED }}>
            not your keys.
          </div>
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
    size,
  );
}
