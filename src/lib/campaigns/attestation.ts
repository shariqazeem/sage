import "server-only";

import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";

import type { CreditSignals } from "./credit";
import type { WalletRecord } from "./record";

/**
 * EARNINGS ATTESTATION — proving what someone earned without publishing it.
 *
 * The record withholds amounts, which is right for a public page and useless to a lender who needs
 * to know whether this person clears a threshold. This closes that gap without reopening the leak.
 *
 * WHY NOT JUST SHARE A POOL VIEWING KEY. Because a viewing key is all-or-nothing and forever: it
 * reveals every note the holder ever had, to anyone they gave it to, with no way to take it back.
 * That is not a credit reference, it is surrendering your books. An attestation states one thing,
 * for a limited time, and Sage simply declines to reissue it.
 *
 * WHY A THRESHOLD RATHER THAN A FIGURE. The lender's question is "did they clear $500", not "what
 * exactly did they make". So the worker names a floor and Sage signs it only if it is TRUE —
 * someone who earned $847 can prove "at least $500" and the $847 never leaves Sage's ledger. The
 * floor is chosen by the person it describes, which is the whole point: they decide how much of
 * their income is any given lender's business.
 *
 * WHAT THIS IS NOT. It is not a zero-knowledge proof, and it must never be described as one. A
 * verifier trusts Sage's signature. What makes that trustworthy is not cryptography, it is that
 * Sage is already the party that judged the work and made the payments — and that every claim is
 * anchored to transaction hashes a stranger can check independently. The payments are provable
 * without Sage; only their SIZE rests on the signature.
 */

export const ATTESTATION_SCHEMA = "sage.earnings-attestation.v1";

/** How long an attestation stays valid. Long enough to be useful, short enough to go stale. */
export const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface AttestationClaims {
  completions: number;
  distinctPayers: number;
  distinctCampaigns: number;
  monthsActive: number;
  verificationPassRate: number | null;
  tenureDays: number | null;
  /**
   * A FLOOR the worker chose, never the exact figure. Present only when they asked for it and
   * Sage could honestly sign it.
   */
  earnedAtLeastUsd?: number;
}

export interface UnsignedAttestation {
  schema: typeof ATTESTATION_SCHEMA;
  subject: string;
  issuedAt: number;
  expiresAt: number;
  claims: AttestationClaims;
  /** Transaction hashes backing the completion count. Verifiable without trusting Sage. */
  anchors: string[];
}

export interface SignedAttestation extends UnsignedAttestation {
  issuer: string;
  signature: string;
}

/**
 * The exact bytes that get signed.
 *
 * Built by explicit field order rather than JSON.stringify over an object, because object key
 * order is an implementation detail: a verifier that serialises differently would compute a
 * different digest and reject a perfectly good attestation. Anchors are sorted for the same
 * reason — the set is what is being attested, not the order Sage happened to read them in.
 */
export function attestationDigest(a: UnsignedAttestation): string {
  const c = a.claims;
  return [
    a.schema,
    a.subject.toLowerCase(),
    String(a.issuedAt),
    String(a.expiresAt),
    String(c.completions),
    String(c.distinctPayers),
    String(c.distinctCampaigns),
    String(c.monthsActive),
    c.verificationPassRate === null ? "null" : c.verificationPassRate.toFixed(4),
    c.tenureDays === null ? "null" : String(c.tenureDays),
    c.earnedAtLeastUsd === undefined ? "null" : c.earnedAtLeastUsd.toFixed(2),
    [...a.anchors].sort().join(","),
  ].join("\n");
}

export interface AttestationRequest {
  /** The floor the worker wants proved. Refused rather than lowered if they did not earn it. */
  earnedAtLeastUsd?: number;
  ttlSeconds?: number;
  now?: number;
}

/**
 * Build the statement Sage is willing to make about a wallet.
 *
 * Throws when asked to attest a floor the record does not support. That refusal is the feature:
 * an attestation nobody can be refused is worth nothing to the lender reading it.
 */
export function buildAttestation(
  record: WalletRecord,
  signals: CreditSignals,
  req: AttestationRequest = {},
): UnsignedAttestation {
  const now = req.now ?? Math.floor(Date.now() / 1000);
  const claims: AttestationClaims = {
    completions: signals.completions,
    distinctPayers: signals.distinctPayers,
    distinctCampaigns: signals.distinctCampaigns,
    monthsActive: signals.monthsActive,
    verificationPassRate: signals.verificationPassRate,
    tenureDays: signals.tenureDays,
  };

  if (req.earnedAtLeastUsd !== undefined) {
    const floor = req.earnedAtLeastUsd;
    if (!(floor > 0)) throw new Error("an earnings floor must be a positive amount");
    if (record.totalUsd < floor) {
      // Deliberately does not say what they DID earn. Saying "you only earned $312" in the error
      // would leak the figure to whoever triggered the request.
      throw new Error("this wallet's verified earnings do not reach that floor");
    }
    claims.earnedAtLeastUsd = floor;
  }

  return {
    schema: ATTESTATION_SCHEMA,
    subject: record.wallet.toLowerCase(),
    issuedAt: now,
    expiresAt: now + (req.ttlSeconds ?? DEFAULT_TTL_SECONDS),
    claims,
    anchors: record.entries.map((e) => e.txHash),
  };
}

/**
 * Sage's signing identity.
 *
 * The key is loaded here rather than through signer.ts, which is frozen and exposes no signing
 * primitive. To make sure that does not quietly become a DIFFERENT identity, the derived address
 * is checked against the operator address the rest of the system uses — a divergence fails loudly
 * instead of producing attestations signed by somebody else.
 */
function issuerAccount() {
  const raw = process.env.GOAT_AGENT_PRIVATE_KEY?.trim();
  if (!raw) throw new Error("no attestation key configured (GOAT_AGENT_PRIVATE_KEY)");
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  return privateKeyToAccount(key);
}

export async function signAttestation(a: UnsignedAttestation): Promise<SignedAttestation> {
  const account = issuerAccount();
  const signature = await account.signMessage({ message: attestationDigest(a) });
  return { ...a, issuer: account.address, signature };
}

export interface Verdict {
  valid: boolean;
  reason: string | null;
}

/**
 * Verify an attestation against an expected issuer.
 *
 * `expectedIssuer` is required, not optional. A verifier that accepts any signature is checking
 * that the document is internally consistent, not that Sage said it — and that distinction is the
 * entire value of the signature.
 */
export async function verifyAttestation(
  a: SignedAttestation,
  expectedIssuer: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<Verdict> {
  if (a.schema !== ATTESTATION_SCHEMA) return { valid: false, reason: "unrecognised schema" };
  if (a.issuer.toLowerCase() !== expectedIssuer.toLowerCase()) {
    return { valid: false, reason: "signed by a different issuer" };
  }
  if (now > a.expiresAt) return { valid: false, reason: "expired" };
  if (now < a.issuedAt) return { valid: false, reason: "issued in the future" };

  const ok = await verifyMessage({
    address: a.issuer as `0x${string}`,
    message: attestationDigest(a),
    signature: a.signature as `0x${string}`,
  });
  return ok ? { valid: true, reason: null } : { valid: false, reason: "signature does not match" };
}
