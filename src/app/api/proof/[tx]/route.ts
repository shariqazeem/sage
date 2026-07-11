import { NextResponse } from "next/server";
import { getPayoutProof } from "@/lib/deputy/chain";
import { getCampaignByPayoutTx, getDecisionByPayoutTx } from "@/lib/db/campaigns";
import { briefFromRow } from "@/lib/deputy/decisions";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/proof/<tx>  (also accepts /api/proof/<tx>.json) — the machine-readable
 * receipt for one payout: the on-chain proof (authoritative, read live) plus the
 * Deputy's decision brief when one is stored. Same shape philosophy as
 * /api/agent/card — everything here is real, nothing self-asserted, so another
 * agent (or the ClawUp sage-deputy skill) can verify Sage's work programmatically.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ tx: string }> },
) {
  const { tx: raw } = await ctx.params;
  const tx = raw.replace(/\.json$/i, "");

  const chainId = getCampaignByPayoutTx(tx)?.chainId;
  const proof = await getPayoutProof(tx, chainId).catch(() => null);
  if (!proof) {
    return NextResponse.json(
      { error: "Not a recognized Sage payout." },
      { status: 404 },
    );
  }

  const decision = getDecisionByPayoutTx(tx);
  const b = decision ? briefFromRow(decision) : null;

  return NextResponse.json(
    {
      tx: proof.txHash,
      chainId: proof.chainId,
      network: proof.network,
      settled: proof.settled,
      amountUsd: proof.amount,
      recipient: proof.recipient,
      vault: proof.vault,
      blockNumber: proof.blockNumber,
      failedCheckIndex: proof.failedCheckIndex,
      explorerTxUrl: proof.explorerUrl, // already the full …/tx/<hash> URL
      proofUrl: `${siteUrl()}/proof/${proof.txHash}`,
      brief: b
        ? {
            engine: b.engine,
            model: b.model,
            provider: b.provider,
            recommendation: b.recommendation,
            reasonCode: b.reasonCode,
            confidence: b.confidence,
            summary: b.summary,
            criteria: b.criteria,
            fraudSignals: b.fraudSignals,
            evidenceOk: b.evidenceOk,
            contentSha256: b.contentSha256,
            latencyMs: b.latencyMs,
            costUsd: b.costUsd,
            x402PaymentTx: b.x402PaymentTx,
          }
        : null,
    },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" } },
  );
}
