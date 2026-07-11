import { ImageResponse } from "next/og";
import { composeProof, isFoundProof } from "@/lib/deputy/proof";
import { getCampaignByPayoutTx } from "@/lib/db/campaigns";
import { siteUrl } from "@/lib/site";

// Reads the real tx (DB + chain) via the canonical composer, so it runs on Node.
export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Sage payout proof";

const INK = "#0A0E14";
const PAPER = "#F8F9FA";
const MUTED = "#9BA1A6";
const SETTLED = "#10B981";
const BLOCKED = "#EF4444";
const WARN = "#F59E0B";

const shortTx = (s: string) => (s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s);
const domain = () => siteUrl().replace(/^https?:\/\//, "");

/**
 * The real share card for /proof/<tx> — from THE canonical proof composer, so the
 * OG image can never disagree with the page. Ink background, big amount, a
 * verdict chip (SETTLED / BLOCKED / FLAGGED), the short tx and branded domain.
 * A generic Sage card renders if the tx can't be read (never a broken image).
 */
export default async function OG({ params }: { params: Promise<{ tx: string }> }) {
  const { tx } = await params;
  const chainId = getCampaignByPayoutTx(tx)?.chainId;
  const composed = await composeProof(tx, chainId).catch(() => null);
  const proof = composed && isFoundProof(composed) ? composed : null;

  const mismatch = proof?.state === "commitment_mismatch";
  const settled = proof?.settled ?? false;
  const accent = !proof ? PAPER : mismatch ? WARN : settled ? SETTLED : BLOCKED;
  const label = proof ? (mismatch ? "FLAGGED" : settled ? "SETTLED" : "BLOCKED") : "SAGE";
  const amount = proof ? `$${proof.human.amountUsd.toFixed(2)}` : "Give an agent an allowance";
  const sub = proof
    ? mismatch
      ? `on-chain payment · decision commitment mismatch`
      : settled
        ? `paid on ${proof.human.network}${proof.legacy ? " · legacy" : ", inside an on-chain policy"}`
        : `refused on ${proof.human.network} — no funds moved`
    : "not your keys.";

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
              gap: 14,
              border: `2px solid ${accent}`,
              color: accent,
              borderRadius: 8,
              padding: "10px 22px",
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 3,
            }}
          >
            <div style={{ width: 14, height: 14, borderRadius: 14, background: accent }} />
            {label}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: proof ? 168 : 92, fontWeight: 800, letterSpacing: -5, lineHeight: 1 }}>
            {amount}
          </div>
          <div style={{ fontSize: 32, color: MUTED }}>{sub}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 27, color: MUTED }}>
          <span style={{ color: PAPER }}>Verify on-chain · Sage</span>
          <span>{proof ? shortTx(proof.chain.txHash) : domain()}</span>
        </div>
      </div>
    ),
    size,
  );
}
