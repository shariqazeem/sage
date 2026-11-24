import { ImageResponse } from "next/og";
import { composeProof, isFoundProof } from "@/lib/deputy/proof";
import { getCampaignByPayoutTx } from "@/lib/db/campaigns";
import { siteUrl } from "@/lib/site";
import { tokenSymbol } from "@/lib/format";
import { INK, MARK, PAPER, PENCIL, SEAL, stampAngle } from "@/lib/brand/stop";
import { ogFonts } from "@/lib/brand/og-fonts";

// Reads the real tx (DB + chain) via the canonical composer, so it runs on Node.
export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Sage payout proof";

const XC = "Fira Sans Extra Condensed";

/**
 * The round PAID stamp, at the angle its own transaction gives it: the app's stamp (paid-stamp.tsx), drawn
 * with boxes because Satori renders text in boxes but not inside an SVG image.
 */
function Stamp({ seed, d = 300 }: { seed: string; d?: number }) {
  const k = d / 100;
  const m = 0.13 * k;
  return (
    <div style={{ position: "absolute", right: 70, top: 150, width: d, height: d, display: "flex", transform: `rotate(${stampAngle(seed)}deg)` }}>
      <div style={{ position: "absolute", left: 5 * k - 2.25 * k, top: 5 * k - 2.25 * k, width: 90 * k + 4.5 * k, height: 90 * k + 4.5 * k, borderRadius: 999, border: `${4.5 * k}px solid ${SEAL}`, display: "flex" }} />
      <div style={{ position: "absolute", left: 10.5 * k - 0.7 * k, top: 10.5 * k - 0.7 * k, width: 79 * k + 1.4 * k, height: 79 * k + 1.4 * k, borderRadius: 999, border: `${1.4 * k}px solid ${SEAL}`, display: "flex" }} />
      <div style={{ position: "absolute", left: 40 * k, top: 20 * k + 25 * m, display: "flex", alignItems: "center", height: 150 * m }}>
        <div style={{ width: 118 * m, height: 34 * m, background: SEAL }} />
        <div style={{ width: 38 * m, height: 150 * m, background: SEAL }} />
      </div>
      <div style={{ position: "absolute", left: 0, top: 41 * k, width: d, display: "flex", justifyContent: "center", fontFamily: XC, fontWeight: 800, fontSize: 23 * k, letterSpacing: 2 * k, color: SEAL, lineHeight: 1 }}>PAID</div>
      <div style={{ position: "absolute", left: 30 * k, top: 66 * k, width: 40 * k, height: 7.8 * k, borderTop: `${2.8 * k}px solid ${SEAL}`, borderBottom: `${2.8 * k}px solid ${SEAL}`, display: "flex" }} />
    </div>
  );
}

const shortTx = (s: string) => (s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s);
const domain = () => siteUrl().replace(/^https?:\/\//, "");

/**
 * The real share card for /proof/<tx> — from THE canonical proof composer, so the
 * OG image can never disagree with the page. A document in The Stop: white paper, the amount in ink with
 * Sage's double rule, the round PAID stamp at its transaction's own angle (paid), one strike (refused) or
 * pencil (held), the short tx and the domain. A generic Sage card renders if the tx can't be read (never a
 * broken image).
 */
export default async function OG({ params }: { params: Promise<{ tx: string }> }) {
  const { tx } = await params;
  const chainId = getCampaignByPayoutTx(tx)?.chainId;
  const composed = await composeProof(tx, chainId).catch(() => null);
  const proof = composed && isFoundProof(composed) ? composed : null;

  const mismatch = proof?.state === "commitment_mismatch";
  const settled = proof?.settled ?? false;
  const label = proof ? (mismatch ? "FLAGGED" : settled ? "SETTLED" : "BLOCKED") : "SAGE";
  // Testnet payouts are real on-chain transactions but the token (mUSDC) is valueless —
  // never render them as dollars.
  const isTestnet = proof ? proof.safety.isMainnet === false : false;
  const amount = proof
    ? isTestnet
      ? `${proof.human.amountUsd.toFixed(2)} ${tokenSymbol(proof.chain.chainId)}`
      : `$${proof.human.amountUsd.toFixed(2)}`
    : "Proof of work,";
  const sub = proof
    ? mismatch
      ? `on-chain payment · decision commitment mismatch`
      : settled
        ? `paid on ${proof.human.network}${proof.legacy ? " · legacy" : ", inside an on-chain policy"}`
        : `refused on ${proof.human.network} — no funds moved`
    : "for people.";

  const fonts = await ogFonts();
  const k = 34 / MARK.wall.h;
  return new ImageResponse(
    (
      <div style={{ display: "flex", position: "relative", flexDirection: "column", width: "100%", height: "100%", background: PAPER, color: INK, padding: "56px 64px", justifyContent: "space-between", fontFamily: "Fira Sans" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", height: 34 }}>
              <div style={{ width: MARK.path.w * k, height: MARK.path.h * k, background: INK }} />
              <div style={{ width: MARK.wall.w * k, height: 34, background: SEAL }} />
            </div>
            <div style={{ fontFamily: XC, fontWeight: 800, fontSize: 40, letterSpacing: 2.6 }}>SAGE</div>
          </div>
          <div style={{ display: "flex", fontFamily: "Fira Mono", fontSize: 22, letterSpacing: 2, color: PENCIL }}>{proof ? "RECEIPT" : "PROOF OF WORK"}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontFamily: XC, fontWeight: 800, fontSize: proof ? (isTestnet ? 120 : 176) : 110, lineHeight: 0.92, color: INK, textDecoration: proof && !settled && !mismatch ? "line-through" : "none", textDecorationColor: SEAL }}>
            {amount}
          </div>
          {proof && settled && !mismatch ? <div style={{ display: "flex", width: 300, height: 14, borderTop: `5px solid ${SEAL}`, borderBottom: `5px solid ${SEAL}` }} /> : null}
          <div style={{ display: "flex", fontSize: 32, color: proof && !settled && !mismatch ? SEAL : INK }}>{label === "SAGE" ? sub : `${label === "SETTLED" ? "Paid" : label === "BLOCKED" ? "Refused" : "Held"} · ${sub}`}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "Fira Mono", fontSize: 24, color: PENCIL }}>
          <span>Verify on-chain · {domain()}</span>
          <span>{proof ? shortTx(proof.chain.txHash) : ""}</span>
        </div>

        {proof && settled && !mismatch ? <Stamp seed={proof.chain.txHash} /> : null}
      </div>
    ),
    { ...size, fonts },
  );
}
