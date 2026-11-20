import type { WalletClient } from "viem";
import {
  buildEvidenceClaimTypedData,
  computeEvidenceDigest,
  EVIDENCE_CLAIM_SCHEMA_VERSION,
  EVIDENCE_CLAIM_TTL_SECONDS,
  type EvidenceClaim,
} from "./evidence-claim";

/**
 * SENDING AN ANSWER: the three steps every door shares (the mission board at /c/<id> and the test page
 * at /t/<id>), so the claim a tester signs and the body the server reads are built in exactly one place.
 *
 *   1. `buildEvidenceClaim`: the claim, stamped with the campaign, the mission, the digest of exactly
 *      what is being sent, and the wallet that will be paid.
 *   2. `signEvmEvidenceClaim`: that wallet signs it (EIP-712). Only a real decline reads as a decline.
 *   3. `postEvidence`: POST /api/campaigns/<id>/submit, with the SAME evidence and note the digest covers.
 *
 * Which wallet signs is each door's own question (the session's wallet, never whichever happens to be
 * connected); a Starknet account signs with its own account contract and joins at step 3.
 */
export interface EvidenceMissionRef {
  missionKey: string;
  missionIdHash: string;
  specDigest: string | null;
}

export interface EvidenceInput {
  campaignId: string;
  campaignIdHash: string;
  chainId: number;
  mission: EvidenceMissionRef;
  /** the public link, trimmed; "" when the account is the evidence */
  evidenceUrl: string;
  /** the tester's own words, exactly as they will be sent */
  note: string;
  /** the wallet that is paid: a checksummed EVM address, or a Starknet felt */
  tester: string;
}

export function buildEvidenceClaim(input: EvidenceInput, nowSeconds: number = Math.floor(Date.now() / 1000)): EvidenceClaim {
  return {
    schemaVersion: EVIDENCE_CLAIM_SCHEMA_VERSION,
    publicCampaignId: input.campaignId,
    campaignIdHash: input.campaignIdHash as `0x${string}`,
    missionKey: input.mission.missionKey,
    missionIdHash: input.mission.missionIdHash as `0x${string}`,
    missionSpecDigest: (input.mission.specDigest ?? `0x${"0".repeat(64)}`) as `0x${string}`,
    evidenceDigest: computeEvidenceDigest({ evidenceUrl: input.evidenceUrl, note: input.note }),
    tester: input.tester as `0x${string}`,
    chainId: input.chainId,
    nonce: `n_${Math.floor(nowSeconds).toString(16)}_${input.mission.missionKey}`,
    issuedAt: nowSeconds,
    expiry: nowSeconds + EVIDENCE_CLAIM_TTL_SECONDS,
  };
}

export type SignResult = { ok: true; signature: string } | { ok: false; error: string };

export async function signEvmEvidenceClaim(walletClient: Pick<WalletClient, "signTypedData">, account: `0x${string}`, claim: EvidenceClaim): Promise<SignResult> {
  const typed = buildEvidenceClaimTypedData(claim);
  try {
    const signature = await walletClient.signTypedData({
      account,
      domain: typed.domain,
      types: typed.types,
      primaryType: typed.primaryType,
      message: typed.message,
    });
    return { ok: true, signature };
  } catch (e) {
    // Only 4001 is a decline. Everything else has a real reason and the person deserves it.
    const code = (e as { code?: number })?.code;
    const raw = e instanceof Error ? e.message.split("\n")[0] : String(e);
    return {
      ok: false,
      error: code === 4001 || /user rejected|denied/i.test(raw) ? "You declined the signature. Nothing was submitted." : `Your wallet could not sign this: ${raw.slice(0, 140)}`,
    };
  }
}

/** `needsVerification`: the World ID step is asked for. `needsSocialSignIn`: a Google or X sign-in is. */
export type PostResult = { ok: true } | { ok: false; error: string; needsVerification: boolean; needsSocialSignIn: boolean };

export async function postEvidence(input: EvidenceInput, claim: EvidenceClaim, signature: string | string[]): Promise<PostResult> {
  const res = await fetch(`/api/campaigns/${input.campaignId}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ missionKey: input.mission.missionKey, evidence: input.evidenceUrl, note: input.note, claim, signature }),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; needsVerification?: boolean; needsSocialSignIn?: boolean };
  if (!res.ok) return { ok: false, error: json.error ?? "Could not submit.", needsVerification: !!json.needsVerification, needsSocialSignIn: !!json.needsSocialSignIn };
  return { ok: true };
}
