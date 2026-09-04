import "server-only";
import { getCampaign, listPaidSubmissionsByWallet } from "@/lib/db/campaigns";
import { flaggingLinksOf } from "@/lib/campaigns/wallet-links";
import { founderStorageKey } from "@/lib/auth/founder";
import { identityFor } from "@/lib/db/identity";
import { tierOf, type TierEvidence, type TierVerdict } from "./tier";

/**
 * A wallet's standing, read from the ledger and the links the consolidation watch DISCOVERED.
 * Nothing here is a model's opinion: payouts happened, campaigns are distinct rows, and a flagging
 * link was written by the watch when a payout was forwarded between two submitters. Links a person
 * declared themselves, or that a personhood proof established, are not evidence against them.
 */
export function standingOf(wallet: string): TierVerdict & { evidence: TierEvidence } {
  const paid = listPaidSubmissionsByWallet(wallet);
  const campaigns = new Set(paid.map((s) => s.campaignId));
  const payers = new Set<string>();
  for (const id of campaigns) {
    const c = getCampaign(id);
    if (c) payers.add(founderStorageKey(c.posterWallet));
  }
  /*
    NOT EVERY LINK IS EVIDENCE.

    This read the whole cluster, so the Settings "bind your two rails" button — which Sage itself
    tells a founder to press, so a business paid on GOAT and on Starknet is not underwritten as two
    half-records — flagged them exactly like the on-chain rotation the watch detects. Measured on
    prod 2026-09-05, on the operator's own bound pair: both wallets came back "linked on-chain to 1
    other that took paid work here" and were refused the paid tiers.

    A discovered link still flags, and so does a personhood link — one human standing up a second
    wallet is the thing the nullifier exists to catch. A DECLARED one never does, and it cannot be
    abused to inflate anyone: standing below is computed per wallet, from that wallet's own paid
    submissions, so declaring a cluster neither merges standing nor multiplies it. The only thing
    the flag did to an honest binder was deny them every tier.
  */
  const linked = flaggingLinksOf(wallet).filter((w) => w.toLowerCase() !== wallet.trim().toLowerCase());
  const evidence: TierEvidence = {
    paidCompletions: paid.length,
    distinctCampaigns: campaigns.size,
    distinctPayers: payers.size,
    linkedWallets: linked.length,
    // a verified person is standing on its own — it is the one signal a fresh wallet cannot borrow
    personhood: identityFor(wallet) ? "verified" : null,
  };
  return { ...tierOf(evidence), evidence };
}

/**
 * Standing gates the better-paid work only when it is armed. Off by default: a tier gate over an
 * empty board is a closed door with nowhere to earn the key, so it is turned on once there is open
 * low-paid work to build standing on.
 */
export function identityTiersArmed(env: Record<string, string | undefined> = process.env): boolean {
  return env.IDENTITY_TIERS === "1";
}
