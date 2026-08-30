import "server-only";

import { RpcProvider, verifyMessageInStarknet } from "starknet";

import { normalizeStarknetAddress } from "@/lib/auth/starknet-session";
import { starknetAddresses } from "@/lib/starknet/config";
import { EVIDENCE_CLAIM_SCHEMA_VERSION, type EvidenceClaim } from "./evidence-claim";
import { buildStarknetEvidenceTypedData } from "./starknet-evidence-typed-data";

/**
 * VERIFYING a SNIP-12 evidence commitment. The typed data itself lives in
 * `starknet-evidence-typed-data.ts` — shared with the browser so there is exactly ONE
 * implementation of what gets signed. A second one here would be a second thing to drift, and
 * drift means every signature reads as forged with nothing on screen to explain why.
 */

export type StarknetClaimVerdict =
  | { ok: true; tester: string }
  | {
      ok: false;
      reason:
        | "expired"
        | "not_yet_valid"
        | "bad_signature"
        | "wallet_mismatch"
        | "schema"
        | "evidence_mismatch"
        | "undeployed"
        | "unavailable";
    };

/**
 * Verify a signed evidence commitment against the recipient's own account contract.
 *
 * Mirrors `verifyEvidenceClaim` check for check, in the same order, so the two rails refuse the
 * same things for the same reasons. Never throws.
 */
export async function verifyStarknetEvidenceClaim(
  claim: EvidenceClaim,
  signature: string[],
  ctx: { expectedWallet: string; now: number; evidenceDigest: string },
): Promise<StarknetClaimVerdict> {
  if (claim.schemaVersion !== EVIDENCE_CLAIM_SCHEMA_VERSION) return { ok: false, reason: "schema" };
  if (ctx.now > claim.expiry) return { ok: false, reason: "expired" };
  if (ctx.now + 60 < claim.issuedAt) return { ok: false, reason: "not_yet_valid" };
  // The signed evidence digest must equal the digest the server independently computed from the
  // exact submitted content — changed evidence invalidates the signature.
  if (claim.evidenceDigest.toLowerCase() !== ctx.evidenceDigest.toLowerCase()) {
    return { ok: false, reason: "evidence_mismatch" };
  }

  const wallet = normalizeStarknetAddress(ctx.expectedWallet);
  // The claim NAMES a tester; on this rail the session wallet is the only authority for who is
  // submitting, so the two must agree before anything is verified against a contract.
  if (!wallet || !normalizeStarknetAddress(claim.tester)) return { ok: false, reason: "wallet_mismatch" };
  if (normalizeStarknetAddress(claim.tester) !== wallet) return { ok: false, reason: "wallet_mismatch" };
  if (!Array.isArray(signature) || signature.length === 0) return { ok: false, reason: "bad_signature" };

  const cfg = starknetAddresses();
  if (!cfg) return { ok: false, reason: "unavailable" };
  const provider = new RpcProvider({ nodeUrl: cfg.rpcUrl });

  // Asked BEFORE the signature check, because it is the one failure with a different remedy: an
  // account with no code on THIS network cannot verify anything, so "try again" is advice that can
  // never work. Same order as sign-in, for the same reason.
  try {
    await provider.getClassHashAt(wallet);
  } catch {
    return { ok: false, reason: "undeployed" };
  }

  try {
    const valid = await verifyMessageInStarknet(
      provider,
      buildStarknetEvidenceTypedData(claim, wallet),
      signature,
      wallet,
    );
    if (!valid) return { ok: false, reason: "bad_signature" };
  } catch {
    // An unreachable node, an account whose signature scheme this cannot read, or a genuinely bad
    // signature. None of them is a verified claim.
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true, tester: wallet };
}
