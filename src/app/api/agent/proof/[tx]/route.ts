import { NextResponse, type NextRequest } from "next/server";

import { authenticateAgent } from "@/lib/agent-api/auth";
import { composeProof, isFoundProof } from "@/lib/deputy/proof";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/proof/[tx] — the canonical verified-proof summary for a payout tx, for the
 * ClawUp agent to report + link. Wraps the SAME proof composer the public page + JSON use;
 * `verified` is recomputed on-chain, never a stored flag. Read-only.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ tx: string }> },
): Promise<NextResponse> {
  const auth = authenticateAgent(req);
  if (!auth.ok) return auth.res;

  const { tx } = await ctx.params;
  const txHash = tx.replace(/\.json$/i, "");
  const proof = await composeProof(txHash);
  if (!isFoundProof(proof)) {
    return NextResponse.json({ ok: false, error: "Proof not found." }, { status: 404 });
  }

  const verified = proof.v2?.integrity.verified ?? proof.commitment?.matches ?? false;
  return NextResponse.json({
    ok: true,
    txHash,
    state: proof.state,
    settled: proof.settled,
    verified,
    outcome: proof.human.outcome,
    network: proof.human.network,
    chainId: proof.chain.chainId,
    recipient: proof.human.recipient,
    explorerUrl: proof.chain.explorerUrl,
    proofUrl: `${siteUrl()}/proof/${txHash}`,
  });
}
