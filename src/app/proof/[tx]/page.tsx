import "../../sage-proof.css";
import "../starknet-proof.css";
import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { composeProof, isFoundProof } from "@/lib/deputy/proof";
import { getCampaignByPayoutTx } from "@/lib/db/campaigns";
import { SageProofPage } from "@/components/proof/sage-proof-page";
import { StarknetProofPage } from "@/components/proof/starknet-proof-page";
import { composeStarknetProof, isStarknetPayout } from "@/lib/deputy/starknet-proof";
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
  const canonical = `/proof/${tx}`;

  // Same branch as the page. Without it the EVM composer answers for a Starknet payout and the tab
  // reads "Payout not found" over a receipt that plainly shows one — and that is also the share
  // card, so the wrong answer is what gets posted.
  if (isStarknetPayout(tx)) {
    const sk = await composeStarknetProof(tx);
    const amount = sk.amountUsd !== null ? `$${sk.amountUsd.toFixed(2)}` : "A payout";
    const title = `${amount} paid on Starknet`;
    const shareTitle = `${title} · Sage`;
    const description = sk.campaignTitle
      ? `${amount} settled to ${short(sk.recipient ?? "")} for "${sk.campaignTitle}". Verifiable on Starknet.`
      : `${amount} settled on Starknet by Sage, verifiable on-chain.`;
    return {
      metadataBase: new URL(siteUrl()),
      title,
      description,
      alternates: { canonical },
      openGraph: { title: shareTitle, description, siteName: "Sage", type: "article" },
      twitter: { card: "summary", title: shareTitle, description },
    };
  }

  const proof = await loadProof(tx, chainForTx(tx));
  if (!isFoundProof(proof)) {
    // The layout template appends "· Sage"; adding it here too rendered it twice.
    const title = "Payout not found";
    const shareTitle = `${title} · Sage`;
    const description =
      "This transaction isn't a recognized Sage payout. Verify a real payout on-chain.";
    return {
      metadataBase: new URL(siteUrl()),
      title,
      description,
      alternates: { canonical },
      openGraph: { title: shareTitle, description, siteName: "Sage", type: "article" },
      twitter: { card: "summary", title: shareTitle, description },
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

  // A Starknet payout has no CampaignVault to read, so the EVM composer cannot see it and returns
  // "not found" — which for a payout that genuinely happened is the worst thing a receipt page can
  // say. It gets its own receipt, showing the chain's half and Sage's half labelled separately.
  if (isStarknetPayout(tx)) {
    return <StarknetProofPage proof={await composeStarknetProof(tx)} />;
  }

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
