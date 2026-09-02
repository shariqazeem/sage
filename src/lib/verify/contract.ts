/**
 * THE VERIFICATION CONTRACT — how a mission's completion is checked.
 *
 * Per the verification-system spec (docs/verification-system.md): a mission is only ever generated
 * when its completion can be deterministically or strongly verified. The contract is what the judge
 * routes on. `onchain_*` and `artifact_url` need NO private corpus and NO model trust — the tester
 * does the real action with their own account/wallet and Sage checks the resulting artifact/state,
 * never the prose. That is the answer to "validate rough one-sentence proof": the words can be one
 * line; the artifact carries the proof.
 *
 * PURE TYPES ONLY — no I/O, no viem, no fetch. The verifiers (verifiers.ts) consume these.
 */

export type VerificationKind =
  | "onchain_tx" // a tx hash whose receipt matches a required shape (from/to/value/method/log)
  | "onchain_state" // contract read / balance / ownership at or after a block
  | "artifact_url" // a URL of a created object; live AND carries a tester-specific marker
  | "public_url" // reach a public URL, quote specific expected text (the existing url-verifiable lane)
  | "observation"; // a written account matched against Sage's own private eyes (the existing P16 judge)

/** How strongly a verified result was established — for the receipt and the autopay gate. */
export type VerificationStrength = "deterministic" | "strong" | "corpus";

/** An on-chain transaction the tester performed. Every present field must hold; absent fields are
 *  not checked. `from` is normally the tester's own wallet (bound at judge time, not stored here). */
export interface OnchainTxContract {
  kind: "onchain_tx";
  chainId: number;
  /** the tester's action must land at this address (a DEX router, a factory, a recipient). */
  to?: string;
  /** minimum native value moved, in wei as a decimal string (a paid action). */
  minValueWei?: string;
  /** the call must invoke this 4-byte selector ("0x" + 8 hex) — a specific method. */
  methodSelector?: string;
  /** a log with this topic0 (event signature hash) must be emitted — proof the effect happened. */
  logTopic0?: string;
  /** if set, one of the emitted logs must come from this contract address. */
  logEmitter?: string;
}

/** On-chain state the tester's action produced — ownership / balance / a created object. */
export interface OnchainStateContract {
  kind: "onchain_state";
  chainId: number;
  /** the contract to read. */
  contract: string;
  /** an eth_call: 4-byte selector + ABI-encoded args, "0x…". The tester's address is spliced in at
   *  judge time when `injectTesterArg` is set (e.g. balanceOf(tester) / ownerOf → tester). */
  callData: string;
  /** where in callData (32-byte word index) the tester's address is injected, if any. */
  injectTesterArgWord?: number;
  /** the returned 32-byte word must be ≥ this (uint) — e.g. balanceOf ≥ 1, tokens ≥ 1. */
  minUint?: string;
  /** the returned word must equal the tester's address (ownerOf === tester). */
  expectTesterAddress?: boolean;
}

/** A public, tester-specific object the action created (an agent page, a share link, an export). */
export interface ArtifactUrlContract {
  kind: "artifact_url";
  /** the artifact must live on one of these hosts (the product's domain / a known share host). */
  allowedHosts: string[];
  /** the artifact must carry a tester-specific marker so it is THEIRS, not a generic page:
   *  "wallet" → the tester's address appears; "handle" → a founder-issued handle; "nonce" → an
   *  issued per-submission nonce the tester must place in/at the artifact. */
  markerKind: "wallet" | "handle" | "nonce";
  /** specific text the artifact must also contain (belt-and-suspenders; optional). */
  mustContain?: string[];
}

export interface PublicUrlContract {
  kind: "public_url";
  /** expected text, each a verbatim substring of the fetched page (the existing url lane's rule). */
  expectedText: string[];
}

export interface ObservationContract {
  kind: "observation";
}

export type VerificationContract =
  | OnchainTxContract
  | OnchainStateContract
  | ArtifactUrlContract
  | PublicUrlContract
  | ObservationContract;

/** The outcome of checking one submission against one contract. */
export interface VerificationResult {
  verified: boolean;
  strength: VerificationStrength;
  /** SERVER-SIDE reason (audit) — may name the exact field that failed. */
  detail: string;
  /** leak-safe, tester/founder-readable one-liner — never an answer-key string. */
  publicDetail: string;
  /** artifact_url only: a MinHash fingerprint of the fetched artifact body with the submitter's
   *  marker stripped — lets the dedup layer recognise a COPIED deliverable across wallets without
   *  storing the page. Absent for other kinds and for bodies too short to fingerprint. */
  artifactFingerprint?: string | null;
}

/** The verification strength a contract kind establishes when it verifies. */
export function strengthOf(kind: VerificationKind): VerificationStrength {
  switch (kind) {
    case "onchain_tx":
    case "onchain_state":
      return "deterministic";
    case "artifact_url":
    case "public_url":
      return "strong";
    case "observation":
      return "corpus";
  }
}
