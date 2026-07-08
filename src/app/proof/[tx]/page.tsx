import "../../sage-proof.css";
import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getPayoutProof } from "@/lib/deputy/chain";
import { chainConfig } from "@/lib/deputy/networks";
import { getCampaignByPayoutTx } from "@/lib/db/campaigns";
import { SageProofPage } from "@/components/proof/sage-proof-page";
import { siteUrl } from "@/lib/site";
import { short, usd } from "@/lib/format";

// Reads one real transaction on each request — the proof is the chain.
export const dynamic = "force-dynamic";

/**
 * A payout can live on Metis Sepolia OR GOAT mainnet, so we resolve WHICH chain
 * from the campaign that owns the tx (its `chainId`), then read the proof there.
 * Unknown tx → the active chain, honestly (a not-found renders either way).
 */
function chainForTx(tx: string): number | undefined {
  return getCampaignByPayoutTx(tx)?.chainId;
}

/** One chain read shared by generateMetadata + the page (React request dedupe). */
const loadProof = cache((tx: string, chainId?: number) => getPayoutProof(tx, chainId));

/** Per-payout metadata — a rich, verifiable share card + GEO surface per tx. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tx: string }>;
}): Promise<Metadata> {
  const { tx } = await params;
  const proof = await loadProof(tx, chainForTx(tx));
  const canonical = `/proof/${tx}`;
  if (!proof) {
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
  const title = proof.settled
    ? `${usd(proof.amount)} paid · Sage payout proof`
    : "Payout blocked · Sage proof";
  const description = proof.settled
    ? `${usd(proof.amount)} settled to ${short(proof.recipient)} on ${proof.network}, inside the Deputy's on-chain policy. Verify it yourself — no trust required.`
    : `A ${usd(proof.amount)} payout was refused on-chain by the Deputy's policy vault. No funds moved. Verify it on ${proof.network}.`;
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

  if (!proof) {
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

  // The real campaign this payout settled for, matched by its tx hash.
  const campaign = getCampaignByPayoutTx(proof.txHash);
  const reward = campaign ? campaign.title.toLowerCase() : "a verified, approved reward";

  return (
    <SageProofPage
      proof={proof}
      reward={reward}
      explorerBase={chainConfig(proof.chainId).explorerUrl}
    />
  );
}
