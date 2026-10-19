import type { Address, Hex } from "viem";

/**
 * The x402 v2 wire shapes this facilitator speaks (x402-specification-v2.md §5 and §7), plus the
 * normalized form the verification core works on. Pure types, no runtime.
 */

/** §5.1.2 PaymentRequirements, as it arrives (amounts are decimal strings of atomic units). */
export interface PaymentRequirementsWire {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

/** §5.1.2 ResourceInfo. Carried through untouched; this facilitator never fetches it. */
export interface ResourceInfoWire {
  url: string;
  description?: string;
  mimeType?: string;
}

/** scheme_exact_evm.md §2 Phase 2: the Permit2 authorization the payer signed. */
export interface Permit2AuthorizationWire {
  from: string;
  permitted: { token: string; amount: string };
  spender: string;
  nonce: string;
  deadline: string;
  witness: { to: string; validAfter: string };
}

/** §7.1 POST /verify and §7.2 POST /settle request body. */
export interface FacilitatorRequestWire {
  x402Version: number;
  paymentPayload: {
    x402Version: number;
    resource?: ResourceInfoWire;
    accepted: PaymentRequirementsWire;
    payload: { signature: string; permit2Authorization: Permit2AuthorizationWire };
    extensions?: Record<string, unknown>;
  };
  paymentRequirements: PaymentRequirementsWire;
}

/** §5.4 VerifyResponse. `invalidMessage` is the reference SDK's human-readable companion field. */
export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
}

/** §5.3 SettleResponse. `errorMessage` likewise comes from the reference SDK's type. */
export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  /** The transaction hash; "" when nothing was broadcast, never empty with `settlement_pending`. */
  transaction: string;
  network: string;
  /** The amount actually settled, in atomic units. */
  amount?: string;
}

/** §7.3 SupportedKind and SupportedResponse. */
export interface SupportedKind {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: Record<string, unknown>;
}

export interface SupportedResponse {
  kinds: SupportedKind[];
  extensions: string[];
  signers: Record<string, string[]>;
}

/** PaymentRequirements after parsing: addresses checksummed, the amount a bigint. */
export interface Requirements {
  scheme: string;
  network: string;
  amount: bigint;
  asset: Address;
  payTo: Address;
  maxTimeoutSeconds: number;
  /** `extra.assetTransferMethod`, when present. */
  assetTransferMethod: string | null;
}

/** A parsed /verify or /settle request for the Permit2 method. */
export interface ParsedPayment {
  requirements: Requirements;
  accepted: Requirements;
  payer: Address;
  token: Address;
  amount: bigint;
  spender: Address;
  nonce: bigint;
  deadline: bigint;
  witnessTo: Address;
  validAfter: bigint;
  signature: Hex;
}

/** The outcome of one verification step: pass, or a reason code with a sentence a person can read. */
export type Check = { ok: true } | { ok: false; reason: string; message: string };
