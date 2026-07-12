/**
 * The founder plan-claim. Before an anonymous inspection can be deployed, the founder
 * connects a wallet and signs an EIP-712 claim binding THAT wallet to the EXACT approved
 * plan (inspection, revision, canonical hashes, budget). The server verifies the
 * signature, the nonce (single-use), the domain, the expiry, and that the plan is
 * unchanged — then transfers ownership from the anonymous namespace to the wallet. Pure
 * (viem typed-data hashing/recovery only); the private key never leaves the wallet.
 */

import { getAddress, recoverTypedDataAddress, type Address, type Hex, type TypedDataDomain } from "viem";

export const CLAIM_SCHEMA_VERSION = 1 as const;
/** A claim is valid for a short window only. */
export const CLAIM_TTL_SECONDS = 600;

export interface PlanClaim {
  schemaVersion: number;
  inspectionId: string;
  approvedRevision: number;
  publicCampaignId: string;
  campaignIdHash: Hex;
  missionPlanDigest: Hex;
  totalBudgetBase: string; // base units, as a decimal string
  founder: Address;
  chainId: number;
  nonce: string;
  issuedAt: number; // unix seconds
  expiry: number; // unix seconds
}

function domain(chainId: number): TypedDataDomain {
  return { name: "Sage Launch", version: "1", chainId };
}

const CLAIM_TYPES = {
  PlanClaim: [
    { name: "schemaVersion", type: "uint256" },
    { name: "inspectionId", type: "string" },
    { name: "approvedRevision", type: "uint256" },
    { name: "publicCampaignId", type: "string" },
    { name: "campaignIdHash", type: "bytes32" },
    { name: "missionPlanDigest", type: "bytes32" },
    { name: "totalBudgetBase", type: "uint256" },
    { name: "founder", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "nonce", type: "string" },
    { name: "issuedAt", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

/** The EIP-712 payload the wallet signs (client) — human-readable via the wallet UI. */
export function buildClaimTypedData(claim: PlanClaim) {
  return {
    domain: domain(claim.chainId),
    types: CLAIM_TYPES,
    primaryType: "PlanClaim" as const,
    message: {
      schemaVersion: BigInt(claim.schemaVersion),
      inspectionId: claim.inspectionId,
      approvedRevision: BigInt(claim.approvedRevision),
      publicCampaignId: claim.publicCampaignId,
      campaignIdHash: claim.campaignIdHash,
      missionPlanDigest: claim.missionPlanDigest,
      totalBudgetBase: BigInt(claim.totalBudgetBase),
      founder: getAddress(claim.founder),
      chainId: BigInt(claim.chainId),
      nonce: claim.nonce,
      issuedAt: BigInt(claim.issuedAt),
      expiry: BigInt(claim.expiry),
    },
  };
}

export type ClaimVerdict =
  | { ok: true; founder: Address }
  | { ok: false; reason: "expired" | "not_yet_valid" | "bad_signature" | "wallet_mismatch" | "wrong_chain" | "schema" };

/**
 * Verify a signed claim against the expected wallet + chain + now. Recovers the signer
 * from the EIP-712 signature and confirms it equals the claim's founder AND the session
 * wallet. Nonce single-use + plan-unchanged are enforced by the SERVER (it owns that
 * state); this proves the signature + binding are sound. Never throws.
 */
export async function verifyClaimSignature(
  claim: PlanClaim,
  signature: Hex,
  ctx: { expectedWallet: Address; chainId: number; now: number },
): Promise<ClaimVerdict> {
  if (claim.schemaVersion !== CLAIM_SCHEMA_VERSION) return { ok: false, reason: "schema" };
  if (claim.chainId !== ctx.chainId) return { ok: false, reason: "wrong_chain" };
  if (ctx.now > claim.expiry) return { ok: false, reason: "expired" };
  if (ctx.now + 60 < claim.issuedAt) return { ok: false, reason: "not_yet_valid" };

  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({ ...buildClaimTypedData(claim), signature });
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (getAddress(recovered) !== getAddress(claim.founder)) return { ok: false, reason: "wallet_mismatch" };
  if (getAddress(recovered) !== getAddress(ctx.expectedWallet)) return { ok: false, reason: "wallet_mismatch" };
  return { ok: true, founder: getAddress(recovered) };
}
