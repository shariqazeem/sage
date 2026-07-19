/**
 * The tester evidence-claim. A tester signs an EIP-712 commitment binding THEIR wallet to
 * the EXACT evidence they submit, for a SPECIFIC mission of a specific campaign. The server
 * verifies the signature recovers to the session wallet and that it commits to the exact
 * evidence digest + mission — so a payout can only ever reach the wallet that signed, the
 * evidence cannot be swapped after signing, and a signature for one mission cannot be
 * replayed onto another. Pure (viem typed-data only); the private key never leaves the
 * wallet. Mirrors the founder plan-claim in lib/launch/claim.ts.
 */

import { getAddress, keccak256, recoverTypedDataAddress, stringToHex, type Address, type Hex, type TypedDataDomain } from "viem";

export const EVIDENCE_CLAIM_SCHEMA_VERSION = 1 as const;
/** A claim is valid for a short window only. */
export const EVIDENCE_CLAIM_TTL_SECONDS = 600;

export interface EvidenceInput {
  /** the public HTTPS evidence URL (or empty when the mission needs none). */
  evidenceUrl: string;
  /** the tester's freeform note (untrusted). */
  note: string;
}

/**
 * Canonical evidence digest — a stable keccak256 over the EXACT submitted content, so the
 * signature binds to precisely this evidence. Changing a single character changes the
 * digest and invalidates the signature.
 *
 * The URL is canonicalized (`new URL().toString()`) BEFORE hashing, on both client and server. The
 * server validates the link with `validateEvidenceUrl` → `url.toString()`, which appends a trailing
 * slash to a bare domain (`https://x.com` → `https://x.com/`); if the client hashed the raw string a
 * bare-domain link would sign one digest and verify as another (evidence_mismatch at submit). This is
 * idempotent for an already-canonical URL; a syntactically invalid URL is left as-is (the server
 * rejects it separately with a clearer message).
 */
export function computeEvidenceDigest(input: EvidenceInput): Hex {
  let url = (input.evidenceUrl ?? "").trim();
  if (url) {
    try {
      url = new URL(url).toString();
    } catch {
      /* leave as-is — validateEvidenceUrl surfaces the real "must be a valid URL" error */
    }
  }
  const canonical = JSON.stringify({ url, note: input.note ?? "" });
  return keccak256(stringToHex(canonical));
}

export interface EvidenceClaim {
  schemaVersion: number;
  publicCampaignId: string;
  campaignIdHash: Hex;
  missionKey: string;
  missionIdHash: Hex;
  missionSpecDigest: Hex;
  evidenceDigest: Hex;
  tester: Address;
  chainId: number;
  nonce: string;
  issuedAt: number; // unix seconds
  expiry: number; // unix seconds
}

function domain(chainId: number): TypedDataDomain {
  return { name: "Sage Campaign", version: "1", chainId };
}

const CLAIM_TYPES = {
  EvidenceClaim: [
    { name: "schemaVersion", type: "uint256" },
    { name: "publicCampaignId", type: "string" },
    { name: "campaignIdHash", type: "bytes32" },
    { name: "missionKey", type: "string" },
    { name: "missionIdHash", type: "bytes32" },
    { name: "missionSpecDigest", type: "bytes32" },
    { name: "evidenceDigest", type: "bytes32" },
    { name: "tester", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "nonce", type: "string" },
    { name: "issuedAt", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

/** The EIP-712 payload the tester's wallet signs — human-readable in the wallet UI. */
export function buildEvidenceClaimTypedData(claim: EvidenceClaim) {
  return {
    domain: domain(claim.chainId),
    types: CLAIM_TYPES,
    primaryType: "EvidenceClaim" as const,
    message: {
      schemaVersion: BigInt(claim.schemaVersion),
      publicCampaignId: claim.publicCampaignId,
      campaignIdHash: claim.campaignIdHash,
      missionKey: claim.missionKey,
      missionIdHash: claim.missionIdHash,
      missionSpecDigest: claim.missionSpecDigest,
      evidenceDigest: claim.evidenceDigest,
      tester: getAddress(claim.tester),
      chainId: BigInt(claim.chainId),
      nonce: claim.nonce,
      issuedAt: BigInt(claim.issuedAt),
      expiry: BigInt(claim.expiry),
    },
  };
}

export type EvidenceClaimVerdict =
  | { ok: true; tester: Address }
  | { ok: false; reason: "expired" | "not_yet_valid" | "bad_signature" | "wallet_mismatch" | "wrong_chain" | "schema" | "evidence_mismatch" };

/**
 * Verify a signed evidence claim: the signature recovers to the session wallet AND commits
 * to the exact evidence digest submitted. Nonce single-use + mission-liveness are enforced
 * by the SERVER (the mission-scoped submission uniqueness index is the single-use guard);
 * this proves the signature binds wallet→evidence→mission soundly. Never throws.
 */
export async function verifyEvidenceClaim(
  claim: EvidenceClaim,
  signature: Hex,
  ctx: { expectedWallet: Address; chainId: number; now: number; evidenceDigest: Hex },
): Promise<EvidenceClaimVerdict> {
  if (claim.schemaVersion !== EVIDENCE_CLAIM_SCHEMA_VERSION) return { ok: false, reason: "schema" };
  if (claim.chainId !== ctx.chainId) return { ok: false, reason: "wrong_chain" };
  if (ctx.now > claim.expiry) return { ok: false, reason: "expired" };
  if (ctx.now + 60 < claim.issuedAt) return { ok: false, reason: "not_yet_valid" };
  // The signed evidence digest must equal the digest the server independently computed
  // from the exact submitted content — changed evidence invalidates the signature.
  if (claim.evidenceDigest.toLowerCase() !== ctx.evidenceDigest.toLowerCase()) return { ok: false, reason: "evidence_mismatch" };

  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({ ...buildEvidenceClaimTypedData(claim), signature });
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (getAddress(recovered) !== getAddress(claim.tester)) return { ok: false, reason: "wallet_mismatch" };
  if (getAddress(recovered) !== getAddress(ctx.expectedWallet)) return { ok: false, reason: "wallet_mismatch" };
  return { ok: true, tester: getAddress(recovered) };
}
