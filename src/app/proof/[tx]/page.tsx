import "../../sage-proof.css";
import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { composeProof, isFoundProof } from "@/lib/deputy/proof";
import { getCampaignByPayoutTx } from "@/lib/db/campaigns";
import { SageProofPage } from "@/components/proof/sage-proof-page";
import { siteUrl } from "@/lib/site";
import { short, money } from "@/lib/format";

// Reads one real transaction on each request — the proof is the chain.
export const dynamic = "force-dynamic";

/**
 * A payout can live on Metis Sepolia OR GOAT mainnet, so we resolve WHICH chain
 * from the campaign (or durable attempt) that owns the tx, then compose the proof
 * there. One canonical composer feeds both generateMetadata and the page (React
 * request dedupe).
 */
function chainForTx(tx: string): number | undefined {
  return getCampaignByPayoutTx(tx)?.chainId;
}

const loadProof = cache((tx: string, chainId?: number) => composeProof(tx, chainId));

/** Per-payout metadata — a rich, verifiable share card + GEO surface per tx. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tx: string }>;
}): Promise<Metadata> {
  const { tx } = await params;
  const proof = await loadProof(tx, chainForTx(tx));
  const canonical = `/proof/${tx}`;
  if (!isFoundProof(proof)) {
    const title = "Payout not found · Sage";
    const description =
      "This transaction isn't a recognized Sage payout. Verify a real payout on-chain.";
    return {
      metadataBase: new URL(siteUrl()),
      title,
      description,
      alternates: { canonical },
      openGraph: { title, description, siteName: "Sage", type: "article" },
      twitter: { card: "summary", title, description },
    };
  }
  const amount = money(proof.human.amountUsd, proof.chain.chainId);
  const title = proof.settled
    ? `${amount} paid · Sage payout proof`
    : "Payout blocked · Sage proof";
  const description = proof.settled
    ? `${amount} settled to ${short(proof.human.recipient)} on ${proof.human.network}, inside Sage's on-chain policy${proof.legacy ? "" : " — verified against its AI decision"}. Verify it yourself.`
    : `A ${amount} payout was refused on-chain by Sage's policy vault. No funds moved. Verify it on ${proof.human.network}.`;
  return {
    metadataBase: new URL(siteUrl()),
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: `${siteUrl()}${canonical}`,
      siteName: "Sage",
      type: "article",
    },
    twitter: { card: "summary", title, description },
  };
}

export default async function ProofPage({
  params,
}: {
  params: Promise<{ tx: string }>;
}) {
  const { tx } = await params;
  const proof = await loadProof(tx, chainForTx(tx));

  if (!isFoundProof(proof)) {
    return (
      <div className="spp">
        <div className="spp-nf spp-reveal">
          <h1>Payout not found</h1>
          <p>
            This transaction isn&apos;t a recognized Sage payout, or it
            hasn&apos;t been indexed yet. Double-check the hash.
          </p>
          <Link href="/">
            <ArrowLeft size={15} /> Back to Sage
          </Link>
        </div>
      </div>
    );
  }

  return <SageProofPage proof={proof} />;
}
