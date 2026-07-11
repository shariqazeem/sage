import { NextResponse } from "next/server";
import { composeProof, isFoundProof } from "@/lib/deputy/proof";
import { getCampaignByPayoutTx } from "@/lib/db/campaigns";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/proof/<tx>  (also accepts /api/proof/<tx>.json) — the machine-readable
 * receipt for one payout, from THE canonical proof composer (same truth the HTML
 * page, OG image, and agent profile read). Every field is real: the on-chain
 * proof read live, the Deputy's sanitized decision brief when stored, and the
 * DecisionCommitmentV1 verification (recomputed vs stored vs on-chain intent).
 *
 * Schema v1. The pre-v1 top-level fields (tx, chainId, network, settled,
 * amountUsd, recipient, vault, blockNumber, failedCheckIndex, explorerTxUrl,
 * proofUrl, brief) are PRESERVED for the ClawUp sage-deputy skill; the versioned
 * proof state + commitment verification are added alongside. A mismatch or
 * incomplete state is NEVER returned as a verified success — `verified` and
 * `commitmentMatches` say so explicitly.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ tx: string }> },
) {
  const { tx: raw } = await ctx.params;
  const tx = raw.replace(/\.json$/i, "");

  const chainId = getCampaignByPayoutTx(tx)?.chainId;
  const proof = await composeProof(tx, chainId);

  if (!isFoundProof(proof)) {
    return NextResponse.json(
      { schemaVersion: proof.version, proofState: "not_found", error: "Not a recognized Sage payout." },
      { status: 404 },
    );
  }

  const committed =
    proof.state === "committed_settlement" || proof.state === "committed_rejection";

  return NextResponse.json(
    {
      // ── versioned proof state (new) ──────────────────────────────────────
      schemaVersion: proof.version,
      proofState: proof.state,
      /** true ONLY when the on-chain payout is verified against its AI decision. */
      verified: committed,
      legacy: proof.legacy,
      commitmentMatches: proof.commitment ? proof.commitment.matches : null,
      commitment: proof.commitment,
      human: proof.human,
      chain: proof.chain,
      vaultCapability: proof.safety.replaySupport,
      policy: {
        budget: proof.safety.budget,
        perTxCap: proof.safety.perTxCap,
        velocityCap: proof.safety.velocityCap,
        remaining: proof.safety.remaining,
        isMainnet: proof.safety.isMainnet,
      },

      // ── pre-v1 fields, PRESERVED for ClawUp compatibility ────────────────
      tx: proof.chain.txHash,
      chainId: proof.chain.chainId,
      network: proof.chain.network,
      settled: proof.settled,
      amountUsd: proof.human.amountUsd,
      recipient: proof.human.recipient,
      vault: proof.chain.vault,
      blockNumber: proof.chain.blockNumber,
      failedCheckIndex: proof.human.failedCheckIndex,
      explorerTxUrl: proof.chain.explorerUrl, // already the full …/tx/<hash> URL
      proofUrl: `${siteUrl()}/proof/${proof.chain.txHash}`,
      brief: proof.decision,
    },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" } },
  );
}
