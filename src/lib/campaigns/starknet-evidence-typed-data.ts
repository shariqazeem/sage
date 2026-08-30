import { toFelt } from "@/lib/starknet/felt";
import type { EvidenceClaim } from "./evidence-claim";

/**
 * THE SAME PROMISE AS THE EVM EVIDENCE CLAIM, IN SNIP-12.
 *
 * A mission-bound submission must carry a signature that binds THIS wallet to THIS evidence for
 * THIS mission, so evidence cannot be swapped after signing and a signature cannot be replayed
 * onto another mission. On the EVM rail that is an EIP-712 signature recovered to an address.
 *
 * Starknet accounts are CONTRACTS: there is nothing to recover to. The account itself decides
 * whether a signature is valid, through `is_valid_signature`, which is what founder sign-in
 * already does. Until now the submit route refused mission-bound work on this rail rather than
 * ship a weaker guarantee — the honest call, but it meant a funded Starknet vault willing to pay
 * could never receive a submission at all.
 *
 * ONLY FELTS ARE SIGNED. Two reasons, both learned the hard way on this rail:
 *
 *   · A Cairo shortstring holds 31 ASCII characters. A public campaign id is generated from the
 *     product's host and can exceed that, so signing the raw id would make some campaigns
 *     unsignable — a failure that would appear only for founders with long domains.
 *   · A 256-bit hash does not fit a felt (251 bits). Each is reduced with the SAME `toFelt` the
 *     vault is keyed by, so the value signed here is the value settlement looks up.
 *
 * The reduction loses five bits and costs nothing: the claim's DECLARED full-precision fields are
 * still compared against the campaign's own by the submit route before this runs, so the reduced
 * felts cannot be steered independently of them.
 */

/** Shown in the wallet. A Cairo shortstring, so it must stay within 31 ASCII characters. */
export const EVIDENCE_STATEMENT = "Sage: commit evidence";

export function buildStarknetEvidenceTypedData(claim: EvidenceClaim, wallet: string) {
  return {
    domain: { name: "Sage", version: "1", chainId: "SN_MAIN", revision: "1" },
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      EvidenceCommitment: [
        { name: "statement", type: "shortstring" },
        { name: "wallet", type: "felt" },
        { name: "campaign", type: "felt" },
        { name: "mission", type: "felt" },
        { name: "missionSpec", type: "felt" },
        { name: "evidence", type: "felt" },
        { name: "issuedAt", type: "felt" },
        { name: "expiry", type: "felt" },
      ],
    },
    primaryType: "EvidenceCommitment",
    message: {
      statement: EVIDENCE_STATEMENT,
      wallet: toFelt(wallet),
      campaign: toFelt(claim.campaignIdHash),
      mission: toFelt(claim.missionIdHash),
      missionSpec: toFelt(claim.missionSpecDigest),
      evidence: toFelt(claim.evidenceDigest),
      issuedAt: String(claim.issuedAt),
      expiry: String(claim.expiry),
    },
  };
}
